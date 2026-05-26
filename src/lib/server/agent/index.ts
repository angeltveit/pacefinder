/**
 * Agent pipeline entry point.
 * Called by POST /api/agent/run (protected by AGENT_SECRET).
 */
import { db } from '$lib/server/db';
import {
	agentRuns,
	raceSeries,
	raceEditions,
	raceDistances,
	settings,
	notifications,
	user
} from '$lib/server/db/schema';
import { incrStat, setHash, KEYS } from '$lib/server/redis';
import { env } from '$env/dynamic/private';
import { eq, gte, and, isNull, sql } from 'drizzle-orm';
import type { ClassifiedRace } from './types';
import { classifyRaces } from './classifier';
import { deduplicateRaces } from './dedup';
import { enrichRaces } from './enrichment';
import { scrapeRaceResults, searchAllTimingProviders } from './results';
import { scrapeKondis } from './sources/kondis';
import { scrapeFriidrett } from './sources/friidrett';
import { searchTavily } from './sources/tavily';
import { searchGoogle } from './sources/google';
import { scrapeSocial } from './sources/social';
import { scrapeEqTiming } from './sources/eqtiming';
import type { RawRaceLead } from './types';

// ---------------------------------------------------------------------------
// Fingerprint helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[æ]/g, 'ae')
		.replace(/[ø]/g, 'oe')
		.replace(/[å]/g, 'aa')
		.replace(/[^a-z0-9|]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function makeSeriesFingerprint(eventName: string, city: string): string {
	return slugify(`${eventName}|${city}`);
}

function makeEditionFingerprint(eventName: string, city: string, year: number | null): string {
	return slugify(`${eventName}|${city}|${year ?? 'nodate'}`);
}

// ---------------------------------------------------------------------------
// Shared 3-level upsert — also exported for use in admin scrape-url endpoint
// ---------------------------------------------------------------------------

export async function upsertClassifiedRace(
	race: ClassifiedRace,
	onLog: (msg: string) => void = () => {}
): Promise<{ isNew: boolean }> {
	const eventName = race.eventName ?? race.name;
	const year = race.raceDate ? race.raceDate.getFullYear() : null;
	const sf = makeSeriesFingerprint(eventName, race.city);
	const ef = makeEditionFingerprint(eventName, race.city, year);

	// ── 1. Upsert series ────────────────────────────────────────────────

	const existingSeries = await db.query.raceSeries.findFirst({
		where: eq(raceSeries.seriesFingerprint, sf)
	});

	let seriesId: string;
	if (!existingSeries) {
		const [inserted] = await db
			.insert(raceSeries)
			.values({
				name: eventName,
				category: race.category,
				city: race.city,
				country: race.country,
				websiteUrl: race.websiteUrl,
				imageUrl: race.imageUrl,
				whyItFits: race.whyItFits,
				seriesFingerprint: sf
			})
			.returning({ id: raceSeries.id });
		seriesId = inserted.id;
	} else {
		seriesId = existingSeries.id;
		await db
			.update(raceSeries)
			.set({
				websiteUrl: race.websiteUrl ?? existingSeries.websiteUrl,
				imageUrl: race.imageUrl ?? existingSeries.imageUrl,
				whyItFits: race.whyItFits || existingSeries.whyItFits,
				lastUpdatedAt: new Date()
			})
			.where(eq(raceSeries.id, seriesId));
	}

	// ── 2. Upsert edition ────────────────────────────────────────────────

	const existingEdition = await db.query.raceEditions.findFirst({
		where: eq(raceEditions.editionFingerprint, ef)
	});

	let editionId: string;
	if (!existingEdition) {
		const [inserted] = await db
			.insert(raceEditions)
			.values({
				seriesId,
				year,
				raceDate: race.raceDate,
				location: race.location,
				registrationStatus: race.registrationStatus,
				websiteUrl: race.websiteUrl,
				sourceUrl: race.sourceUrl,
				rawLlmOutput: race.rawLlmOutput,
				editionFingerprint: ef
			})
			.returning({ id: raceEditions.id });
		editionId = inserted.id;
	} else {
		editionId = existingEdition.id;
		await db
			.update(raceEditions)
			.set({
				registrationStatus: race.registrationStatus,
				raceDate: race.raceDate ?? existingEdition.raceDate,
				websiteUrl: race.websiteUrl ?? existingEdition.websiteUrl,
				sourceUrl: race.sourceUrl ?? existingEdition.sourceUrl,
				lastUpdatedAt: new Date()
			})
			.where(eq(raceEditions.id, editionId));
	}

	// ── 3. Upsert distance(s) ─────────────────────────────────────────────
	// If enrichment found multiple distances (e.g. [5, 10]), create one row per distance.
	// Otherwise fall back to the single distanceKm from classification.

	const distancesToUpsert: Array<{ km: number | null; name: string }> =
		race.enrichedDistancesKm && race.enrichedDistancesKm.length > 1
			? race.enrichedDistancesKm
					.sort((a, b) => a - b)
					.map((km) => ({ km, name: `${eventName} – ${km}km` }))
			: [{ km: race.distanceKm, name: race.name }];

	let anyNew = false;
	for (const { km, name } of distancesToUpsert) {
		const existingDist = await db.query.raceDistances.findFirst({
			where: and(
				eq(raceDistances.editionId, editionId),
				km !== null
					? eq(raceDistances.distanceKm, km)
					: isNull(raceDistances.distanceKm)
			)
		});

		if (!existingDist) {
			await db.insert(raceDistances).values({
				editionId,
				name,
				distanceKm: km,
				registrationUrl: race.registrationUrl,
				resultsUrl: race.resultsUrl,
				medalStatus: race.medalStatus
			});
			onLog(`  + new: ${name} (${race.city})`);
			anyNew = true;
		} else {
			await db
				.update(raceDistances)
				.set({
					registrationUrl: race.registrationUrl ?? existingDist.registrationUrl,
					resultsUrl: race.resultsUrl ?? existingDist.resultsUrl,
					medalStatus: race.medalStatus,
					lastUpdatedAt: new Date()
				})
				.where(eq(raceDistances.id, existingDist.id));
		}
	}

	return { isNew: anyNew };
}

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
			scrapeEqTiming().then((r) => { sourcesUsed.push('eqtiming'); onLog(`eqtiming: ${r.length} leads`); return r; }),
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

		// ── Split into new vs known races to avoid re-enriching what we have ──
		const knownFingerprints = new Set(
			(await db.select({ fp: raceEditions.editionFingerprint }).from(raceEditions))
				.map((r) => r.fp)
		);

		const newRaces: typeof deduped = [];
		const knownRaces: typeof deduped = [];
		for (const race of deduped) {
			const eventName = race.eventName ?? race.name;
			const year = race.raceDate ? race.raceDate.getFullYear() : null;
			const ef = makeEditionFingerprint(eventName, race.city, year);
			if (knownFingerprints.has(ef)) {
				knownRaces.push(race);
			} else {
				newRaces.push(race);
			}
		}
		if (knownRaces.length > 0) onLog(`⚡ ${knownRaces.length} known races — skipping enrichment, updating status only`);
		if (newRaces.length > 0) onLog(`✨ ${newRaces.length} new races — running full enrichment`);

		// ── Enrich new races only (visit official pages for dates, medals, images)
		const enriched = newRaces.length > 0 ? await enrichRaces(newRaces, onLog) : [];

		// ── Auto-discover results URLs for new races only ─────────────────────
		const needsResultsUrl = enriched.filter(r => !r.resultsUrl);
		if (needsResultsUrl.length > 0) {
			onLog(`🔍 Searching timing providers for ${needsResultsUrl.length} races without results URL…`);
			for (const race of needsResultsUrl) {
				const url = await searchAllTimingProviders(race.name, race.raceDate, onLog);
				if (url) race.resultsUrl = url;
			}
		}

		// Known races go straight to upsert (registration status update only)
		const allToUpsert = [...enriched, ...knownRaces];

		// ── Upsert into DB ────────────────────────────────────────────────────
		onLog('Saving races to database…');
		let racesNew = 0;
		let racesUpdated = 0;

		for (const race of allToUpsert) {
			const { isNew } = await upsertClassifiedRace(race, onLog);
			if (isNew) {
				racesNew++;
				await incrStat(KEYS.RACES_TOTAL);
				await incrStat(KEYS.RACES_NEW_24H);
				if (race.raceDate && new Date(race.raceDate) > new Date()) {
					await incrStat(KEYS.RACES_UPCOMING);
				}
			} else {
				racesUpdated++;
			}
		}

		// ── Propagate medal confirmations across distances of same edition ────
		await db.execute(sql`
			UPDATE race_distances SET medal_status = 'confirmed', last_updated_at = now()
			WHERE medal_status != 'confirmed'
			AND edition_id IN (
				SELECT edition_id FROM race_distances WHERE medal_status = 'confirmed'
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
