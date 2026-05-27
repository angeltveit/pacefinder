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
import { eq, gte, and, isNull, isNotNull, sql } from 'drizzle-orm';
import type { ClassifiedRace } from './types';
import { classifyRacesBatched } from './classifier';
import { scrapeRaceResults, searchAllTimingProviders } from './results';
import { scrapeEqTiming } from './sources/eqtiming';
import { scrapeSportsTiming } from './sources/sportstiming';
import { scrapeTimataka } from './sources/timataka';
import { scrapeRaceTimer } from './sources/racetimer';
import { scrapeKondis } from './sources/kondis';
import { scrapeFriidrett } from './sources/friidrett';
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

// ── Pre-LLM filter: pure logic to drop obvious non-running/junk leads ─────────

/** Non-running sports — if these appear in name/rawText, drop the lead */
const EXCLUDE_SPORTS = [
	'triathlon', 'triatlon', 'duathlon', 'duatlon',
	'cycling', 'cykel', 'sykkel', 'bike', 'mtb', 'gravel',
	'swimming', 'simning', 'svømming', 'swim',
	'skiing', 'ski ', 'skidor', 'langrenn', 'rulleski', 'skiskyting',
	'orientering', 'orienteering',
	'walking', 'gång', 'gå-', 'stavgang',
	'dog sled', 'hundekjøring',
	'hyrox', 'crossfit',
	'rowing', 'roing', 'padling', 'kayak',
	'ridning', 'equestrian', 'horse',
	'innebandy', 'fotball', 'handball', 'basketball'
];

/** Recurring/training event patterns — weekday jogs, parkruns, series without race identity */
const RECURRING_PATTERNS = [
	/parkrun/i,
	/\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)s?(løp|run)/i,
	/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(run|jog)/i,
	/treningsløp/i,
	/lørdagsløp/i,
	/onsdagsløp/i,
	/tirsdagsløp/i,
	/\buke\s*\d+/i,
	/\bweek\s*\d+/i,
	/hlaupasería/i,
	/løpeserie/i,
	/joggetur/i,
	/trimløp/i
];

/** Kids-only patterns */
const KIDS_PATTERNS = [
	/\bbarn(e)?løp\b/i,
	/\bkids\s*run\b/i,
	/\bmini\s*run\b/i,
	/\bbarnas\b/i,
	/\bunder\s*12\b/i,
	/\bbarneidrett\b/i,
	/\bskolemesterskap\b/i,
	/\bskolemester\b/i
];

/** Virtual race patterns */
const VIRTUAL_PATTERNS = [
	/\bvirtual\b/i,
	/\bvirtualt?\b/i,
	/\bdigitalt?\s*(løp|race)\b/i
];

/** Distance patterns — if we can extract a distance and it's < 3km, drop */
const DISTANCE_REGEX = /(\d+(?:[.,]\d+)?)\s*(?:km|kilometer)/i;
const DISTANCE_SHORT_REGEX = /\b(\d+(?:[.,]\d+)?)\s*k\b/i;

function extractDistanceKm(text: string): number | null {
	const kmMatch = text.match(DISTANCE_REGEX);
	if (kmMatch) return parseFloat(kmMatch[1].replace(',', '.'));
	const kMatch = text.match(DISTANCE_SHORT_REGEX);
	if (kMatch) return parseFloat(kMatch[1].replace(',', '.'));
	// Check for meter-based (e.g. "800m", "1500m")
	const mMatch = text.match(/\b(\d+)\s*m\b/i);
	if (mMatch) {
		const meters = parseInt(mMatch[1]);
		if (meters <= 3000) return meters / 1000;
	}
	return null;
}

function preFilterLead(lead: RawRaceLead): boolean {
	const text = `${lead.name} ${lead.rawText ?? ''} ${lead.description ?? ''}`.toLowerCase();

	// Exclude non-running sports
	if (EXCLUDE_SPORTS.some((kw) => text.includes(kw))) return false;

	// Exclude recurring/training jogs
	if (RECURRING_PATTERNS.some((re) => re.test(text))) return false;

	// Exclude kids-only
	if (KIDS_PATTERNS.some((re) => re.test(text))) return false;

	// Exclude virtual
	if (VIRTUAL_PATTERNS.some((re) => re.test(text))) return false;

	// Exclude if we can definitively tell distance < 3km
	const dist = extractDistanceKm(text);
	if (dist !== null && dist < 3) return false;

	return true;
}

export const ALL_SOURCES = ['eqtiming', 'sportstiming', 'timataka', 'racetimer', 'kondis', 'friidrett'] as const;
export type SourceId = (typeof ALL_SOURCES)[number];

export async function runAgent(
	onLog: (msg: string) => void = () => {},
	enabledSources?: SourceId[]
): Promise<{ racesNew: number; racesUpdated: number }> {
	const active = new Set(enabledSources ?? ALL_SOURCES);

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
		// ── Gather leads from selected Nordic timing sources in parallel ─────
		const scraperMap: Record<SourceId, () => Promise<RawRaceLead[]>> = {
			eqtiming: scrapeEqTiming,
			sportstiming: scrapeSportsTiming,
			timataka: scrapeTimataka,
			racetimer: scrapeRaceTimer,
			kondis: scrapeKondis,
			friidrett: scrapeFriidrett
		};

		const activeSources = ALL_SOURCES.filter((s) => active.has(s));
		onLog(`Scraping ${activeSources.length} Nordic timing sources: ${activeSources.join(', ')}`);

		const results = await Promise.allSettled(
			activeSources.map((id) =>
				scraperMap[id]().then((r) => { sourcesUsed.push(id); onLog(`${id}: ${r.length} leads`); return r; })
			)
		);

		for (const result of results) {
			if (result.status === 'fulfilled') leads.push(...result.value);
		}

		onLog(`Total: ${leads.length} leads gathered from ${sourcesUsed.length} sources`);

		// ── Pre-LLM filtering: pure logic to reduce token spend ───────────────
		const preFilterCount = leads.length;
		const preFiltered = leads.filter(preFilterLead);
		leads.length = 0;
		leads.push(...preFiltered);
		if (preFilterCount !== leads.length) {
			onLog(`Pre-filter: ${leads.length} leads kept (dropped ${preFilterCount - leads.length} non-running/recurring/short)`);
		}

		// ── Filter by date range: current year + next year ───────────────────
		const thisYear = new Date().getFullYear();
		const minDate = `${thisYear}-01-01`;
		const maxDate = `${thisYear + 1}-12-31`;
		const beforeFilter = leads.length;
		const filtered = leads.filter((lead) => {
			if (!lead.date) return true; // no date known — let LLM decide
			return lead.date >= minDate && lead.date <= maxDate;
		});
		leads.length = 0;
		leads.push(...filtered);
		if (beforeFilter !== leads.length) {
			onLog(`Filtered to ${thisYear}–${thisYear + 1}: ${leads.length} leads (dropped ${beforeFilter - leads.length} outside range)`);
		}

		// ── Skip leads already stored in DB (by source URL) ───────────────────
		const knownUrls = new Set(
			(await db.select({ url: raceEditions.sourceUrl }).from(raceEditions).where(isNotNull(raceEditions.sourceUrl)))
				.map((r) => r.url!)
		);
		const beforeDedup = leads.length;
		const novel = leads.filter((lead) => !knownUrls.has(lead.url));
		leads.length = 0;
		leads.push(...novel);
		if (beforeDedup !== leads.length) {
			onLog(`Skipped ${beforeDedup - leads.length} already-known races → ${leads.length} new leads for LLM`);
		}

		// ── Classify, insert immediately per batch ────────────────────────────
		onLog(`Classifying ${leads.length} leads with ${env.LLM_MODEL ?? 'gpt-4o-mini'}…`);

		const knownFingerprints = new Set(
			(await db.select({ fp: raceEditions.editionFingerprint }).from(raceEditions))
				.map((r) => r.fp)
		);

		let racesNew = 0;
		let racesUpdated = 0;
		let totalClassified = 0;

		const { tokensIn, tokensOut, costUsd } = await classifyRacesBatched(leads, async (batchRaces, stats) => {
			totalTokensIn += stats.tokensIn;
			totalTokensOut += stats.tokensOut;
			totalCost += stats.costUsd;
			totalClassified += batchRaces.length;
			onLog(`  Batch: ${batchRaces.length} races classified (${stats.tokensIn + stats.tokensOut} tokens)`);

			// Immediately upsert each batch
			for (const race of batchRaces) {
				const eventName = race.eventName ?? race.name;
				const year = race.raceDate ? race.raceDate.getFullYear() : null;
				const ef = makeEditionFingerprint(eventName, race.city, year);
				const isKnown = knownFingerprints.has(ef);

				const { isNew } = await upsertClassifiedRace(race, onLog);
				if (isNew) {
					racesNew++;
					knownFingerprints.add(ef);
					await incrStat(KEYS.RACES_TOTAL);
					await incrStat(KEYS.RACES_NEW_24H);
					if (race.raceDate && new Date(race.raceDate) > new Date()) {
						await incrStat(KEYS.RACES_UPCOMING);
					}
				} else {
					racesUpdated++;
				}
			}
		});

		onLog(`LLM done: ${totalClassified} races classified, ${racesNew} new, ${racesUpdated} updated (${totalTokensIn + totalTokensOut} tokens, $${totalCost.toFixed(4)})`);

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
