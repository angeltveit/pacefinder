/**
 * Agent pipeline entry point.
 * Called by POST /api/agent/run (protected by AGENT_SECRET).
 */
import { db } from '$lib/server/db';
import { agentRuns, races } from '$lib/server/db/schema';
import { incrStat, setHash, KEYS } from '$lib/server/redis';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { classifyRaces } from './classifier';
import { scrapeKondis } from './sources/kondis';
import { scrapeFriidrett } from './sources/friidrett';
import { searchTavily } from './sources/tavily';
import { searchGoogle } from './sources/google';
import { scrapeSocial } from './sources/social';
import type { RawRaceLead } from './types';

export async function runAgent(): Promise<{ racesNew: number; racesUpdated: number }> {
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
		const results = await Promise.allSettled([
			scrapeKondis().then((r) => { sourcesUsed.push('kondis'); return r; }),
			scrapeFriidrett().then((r) => { sourcesUsed.push('friidrett'); return r; }),
			searchTavily().then((r) => { sourcesUsed.push('tavily'); return r; }),
			searchGoogle().then((r) => { sourcesUsed.push('google'); return r; }),
			scrapeSocial().then((r) => { sourcesUsed.push('social'); return r; })
		]);

		for (const result of results) {
			if (result.status === 'fulfilled') leads.push(...result.value);
		}

		// ── Classify and enrich with LLM ──────────────────────────────────────
		const { classified, tokensIn, tokensOut, costUsd } = await classifyRaces(leads);
		totalTokensIn = tokensIn;
		totalTokensOut = tokensOut;
		totalCost = costUsd;

		// ── Upsert into DB ────────────────────────────────────────────────────
		let racesNew = 0;
		let racesUpdated = 0;

		for (const race of classified) {
			const existing = await db.query.races.findFirst({
				where: eq(races.fingerprint, race.fingerprint)
			});

			if (!existing) {
				await db.insert(races).values(race);
				racesNew++;
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
						medalStatus: race.medalStatus,
						lastUpdatedAt: new Date()
					})
					.where(eq(races.fingerprint, race.fingerprint));
				racesUpdated++;
			}
		}

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
