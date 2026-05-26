/**
 * Agent pipeline entry point.
 * Called by POST /api/agent/run (protected by AGENT_SECRET).
 */
import { db } from '$lib/server/db';
import { agentRuns, races, settings, notifications, user } from '$lib/server/db/schema';
import { incrStat, setHash, KEYS } from '$lib/server/redis';
import { env } from '$env/dynamic/private';
import { eq, gte, and, isNull, sql } from 'drizzle-orm';
import { classifyRaces } from './classifier';
import { deduplicateRaces } from './dedup';
import { enrichRaces } from './enrichment';
import { scrapeRaceResults, searchAllTimingProviders } from './results';
import { scrapeKondis } from './sources/kondis';
import { scrapeFriidrett } from './sources/friidrett';
import { searchTavily } from './sources/tavily';
import { searchGoogle } from './sources/google';
import { scrapeSocial } from './sources/social';
import type { RawRaceLead } from './types';

async function checkMonthlyBudget(onLog: (msg: string) => void): Promise<void> {
	onLog('Checking monthly budget…');
	const startOfMonth = new Date();
	startOfMonth.setUTCDate(1);
	startOfMonth.setUTCHours(0, 0, 0, 0);

	const [[{ spend }], budgetRow] = await Promise.all([
		db
			.select({ spend: sql<number>`coalesce(sum(${agentRuns.estimatedCostUsd}), 0)` })
			.from(agentRuns)
			.where(gte(agentRuns.startedAt, startOfMonth)),
		db.query.settings.findFirst({
			where: and(
				eq(settings.scope, 'system'),
				eq(settings.key, 'llm_monthly_budget_usd'),
				isNull(settings.userId)
			)
		})
	]);

	const budget = budgetRow
		? parseFloat(budgetRow.value)
		: parseFloat(env.MONTHLY_LLM_BUDGET_USD ?? '10');
	const monthlySpend = Number(spend);

	onLog(`Budget: $${monthlySpend.toFixed(4)} spent of $${budget.toFixed(2)} this month`);

	if (monthlySpend >= budget) {
		// Notify admins at most once per hour to avoid spam
		const recentNotif = await db.query.notifications.findFirst({
			where: and(
				eq(notifications.type, 'budget_exceeded'),
				gte(notifications.createdAt, new Date(Date.now() - 60 * 60 * 1000))
			)
		});
		if (!recentNotif) {
			const admins = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.role, 'admin'));
			if (admins.length > 0) {
				await db.insert(notifications).values(
					admins.map((a) => ({
						userId: a.id,
						type: 'budget_exceeded',
						payload: {
							monthlySpend: monthlySpend.toFixed(4),
							budget: budget.toFixed(2)
						}
					}))
				);
			}
		}
		throw new Error(
			`Monthly LLM budget of $${budget.toFixed(2)} exceeded ` +
				`(spent $${monthlySpend.toFixed(4)} this month). Extend it in the admin dashboard.`
		);
	}
}

export async function runAgent(
	onLog: (msg: string) => void = () => {}
): Promise<{ racesNew: number; racesUpdated: number }> {
	// Budget guard
	await checkMonthlyBudget(onLog);

	// Create a run record
	const [run] = await db
		.insert(agentRuns)
		.values({ status: 'running' })
		.returning({ id: agentRuns.id });

	const sourcesUsed: string[] = [];
	const leads: RawRaceLead[] = [];
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let totalCost = 0;

	try {
		// ── Gather leads from all sources in parallel ─────────────────────────
		onLog('Gathering leads from all sources in parallel…');
		const results = await Promise.allSettled([
			scrapeKondis().then((r) => { sourcesUsed.push('kondis'); onLog(`kondis: ${r.length} leads`); return r; }),
			scrapeFriidrett().then((r) => { sourcesUsed.push('friidrett'); onLog(`friidrett: ${r.length} leads`); return r; }),
			searchTavily().then((r) => { sourcesUsed.push('tavily'); onLog(`tavily: ${r.length} leads`); return r; }),
			searchGoogle().then((r) => { sourcesUsed.push('google'); if (r.length) onLog(`google: ${r.length} leads`); return r; }),
			scrapeSocial().then((r) => { sourcesUsed.push('social'); if (r.length) onLog(`social: ${r.length} leads`); return r; })
		]);

		for (const result of results) {
			if (result.status === 'fulfilled') leads.push(...result.value);
		}

		onLog(`Total: ${leads.length} leads gathered`);

		// ── Classify and enrich with LLM ──────────────────────────────────────
		onLog(`Classifying with ${env.LLM_MODEL ?? 'gpt-4o-mini'}…`);
		const { classified, tokensIn, tokensOut, costUsd } = await classifyRaces(leads);
		onLog(`LLM returned ${classified.length} qualifying races (${tokensIn + tokensOut} tokens, $${costUsd.toFixed(4)})`);
		totalTokensIn = tokensIn;
		totalTokensOut = tokensOut;
		totalCost = costUsd;

		// ── Deduplicate: LLM identifies same races with different names ───────
		const deduped = await deduplicateRaces(classified, onLog);

		// ── Enrich: visit official pages for dates, medals, images ────────────
		const enriched = await enrichRaces(deduped, onLog);

		// ── Auto-discover results URLs on known timing providers ──────────────
		const needsResultsUrl = enriched.filter(r => !r.resultsUrl);
		if (needsResultsUrl.length > 0) {
			onLog(`🔍 Searching timing providers for ${needsResultsUrl.length} races without results URL…`);
			for (const race of needsResultsUrl) {
				const url = await searchAllTimingProviders(race.name, race.raceDate, onLog);
				if (url) race.resultsUrl = url;
			}
		}

		// ── Upsert into DB ────────────────────────────────────────────────────
		onLog('Saving races to database…');
		let racesNew = 0;
		let racesUpdated = 0;

		for (const race of enriched) {
			const existing = await db.query.races.findFirst({
				where: eq(races.fingerprint, race.fingerprint)
			});

			if (!existing) {
				await db.insert(races).values(race);
				racesNew++;
				onLog(`  + new: ${race.name} (${race.city})`);
				await incrStat(KEYS.RACES_TOTAL);
				await incrStat(KEYS.RACES_NEW_24H);
				if (race.raceDate && new Date(race.raceDate) > new Date()) {
					await incrStat(KEYS.RACES_UPCOMING);
				}
			} else {
				// Only update fields that may have changed
				await db
					.update(races)
					.set({
						registrationStatus: race.registrationStatus,
						registrationUrl: race.registrationUrl ?? existing.registrationUrl,
						resultsUrl: race.resultsUrl ?? existing.resultsUrl,
						medalStatus: race.medalStatus,
						websiteUrl: race.websiteUrl ?? existing.websiteUrl,
						imageUrl: race.imageUrl ?? existing.imageUrl,
						raceDate: race.raceDate ?? existing.raceDate,
						eventName: race.eventName ?? existing.eventName,
						lastUpdatedAt: new Date()
					})
					.where(eq(races.fingerprint, race.fingerprint));
				racesUpdated++;
			}
		}

		// ── Propagate medal confirmations across distances of same event ──────
		await db.execute(sql`
			UPDATE races SET medal_status = 'confirmed', last_updated_at = now()
			WHERE medal_status != 'confirmed'
			AND (
				website_url IN (SELECT website_url FROM races WHERE medal_status = 'confirmed' AND website_url IS NOT NULL)
				OR source_url IN (SELECT source_url FROM races WHERE medal_status = 'confirmed')
				OR EXISTS (
					SELECT 1 FROM races r2
					WHERE r2.medal_status = 'confirmed' AND r2.id != races.id
					AND split_part(races.name, ' – ', 1) = split_part(r2.name, ' – ', 1)
				)
			)
		`);

		// ── Scrape results for completed races ────────────────────────────────
		const { scraped: resultsScraped } = await scrapeRaceResults(onLog);
		if (resultsScraped > 0) onLog(`📊 Scraped results for ${resultsScraped} completed races`);

		// ── Finalize run record ───────────────────────────────────────────────
		await db
			.update(agentRuns)
			.set({
				finishedAt: new Date(),
				status: 'completed',
				racesScanned: leads.length,
				racesNew,
				racesUpdated,
				tokensInput: totalTokensIn,
				tokensOutput: totalTokensOut,
				estimatedCostUsd: totalCost,
				sourcesUsed
			})
			.where(eq(agentRuns.id, run.id));

		// ── Update Redis stats ─────────────────────────────────────────────────
		await incrStat(KEYS.TOKENS_INPUT_ALLTIME, totalTokensIn);
		await incrStat(KEYS.TOKENS_OUTPUT_ALLTIME, totalTokensOut);
		await incrStat(KEYS.TOKENS_COST_ALLTIME, totalCost);
		await incrStat(KEYS.TOKENS_INPUT_TODAY, totalTokensIn);
		await incrStat(KEYS.TOKENS_OUTPUT_TODAY, totalTokensOut);
		await incrStat(KEYS.TOKENS_COST_TODAY, totalCost);

		await setHash(KEYS.AGENT_LAST_RUN, {
			started_at: run.id, // we store the run id — the dashboard queries DB for details
			finished_at: new Date().toISOString(),
			status: 'completed',
			races_new: String(racesNew),
			tokens_in: String(totalTokensIn),
			tokens_out: String(totalTokensOut),
			cost_usd: String(totalCost.toFixed(4))
		});

		return { racesNew, racesUpdated };
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await db
			.update(agentRuns)
			.set({ finishedAt: new Date(), status: 'failed', errorLog: errorMsg })
			.where(eq(agentRuns.id, run.id));
		throw err;
	}
}
