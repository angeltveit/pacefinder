/**
 * LLM-powered deduplication: sends race names/cities/distances to Claude
 * and asks it to identify groups that are the same race.
 * Merges duplicates, keeping the best data from each.
 */
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { ClassifiedRace } from './types';

function getModel() {
	const provider = env.LLM_PROVIDER ?? 'openai';
	const model = env.LLM_MODEL ?? 'gpt-4o-mini';
	const apiKey = env.LLM_API_KEY;

	if (provider === 'anthropic') {
		return createAnthropic({ apiKey })(model);
	}
	return createOpenAI({ apiKey, baseURL: env.LLM_BASE_URL })(model);
}

const DEDUP_PROMPT = `You are deduplicating a list of running races. Some races appear multiple times with slightly different names but are the SAME event + distance.

Rules for identifying duplicates:
- Same city + same distance (10km = 10K = 10 km, 21.1km = 21.0975km = half marathon, 42.2km = 42.195km = marathon) + clearly same event = DUPLICATE
- A race with/without a year suffix is the same race (e.g. "Berlin Marathon 2026" = "BMW Berlin Marathon 2026")
- A race with/without a sponsor prefix is the same race (e.g. "TCS New York City Marathon" = "New York City Marathon")
- "Midnight Sun Marathon" and "Tromsø Midnight Sun Marathon" are the SAME event (same city)
- Different distances of the same event are NOT duplicates (keep "Marathon" and "Half Marathon" separate)
- If unsure, keep them separate

Return groups of indices that are duplicates of each other. Each group means all those races are the same race+distance.
Only include groups with 2+ items. Races not in any group are unique.`;

const dedupeSchema = z.object({
	duplicateGroups: z.array(
		z.object({
			indices: z.array(z.number()).describe('0-based indices of races that are duplicates of each other'),
			canonicalName: z.string().describe('The best/cleanest name to use for this race'),
			reasoning: z.string().describe('Why these are the same race')
		})
	)
});

/**
 * Merge a group of duplicate races into one, keeping the best data from each.
 */
function mergeGroup(group: ClassifiedRace[], canonicalName: string): ClassifiedRace {
	// Start with the first one as base
	const merged = { ...group[0], name: canonicalName };

	// Derive eventName from the canonical name (strip distance suffix)
	const dashIdx = canonicalName.indexOf(' – ');
	merged.eventName = dashIdx > 0 ? canonicalName.substring(0, dashIdx) : canonicalName.replace(/\s+\d{4}$/, '');

	for (const race of group.slice(1)) {
		// Keep whichever has a date
		if (!merged.raceDate && race.raceDate) merged.raceDate = race.raceDate;
		// Keep whichever has a registration URL
		if (!merged.registrationUrl && race.registrationUrl) merged.registrationUrl = race.registrationUrl;
		// Keep whichever has a website URL
		if (!merged.websiteUrl && race.websiteUrl) merged.websiteUrl = race.websiteUrl;
		// Keep whichever has an image
		if (!merged.imageUrl && race.imageUrl) merged.imageUrl = race.imageUrl;
		// Upgrade medal status
		if (race.medalStatus === 'confirmed') merged.medalStatus = 'confirmed';
		else if (race.medalStatus === 'likely' && merged.medalStatus === 'unclear') merged.medalStatus = 'likely';
		// Keep better distance precision
		if (race.distanceKm && merged.distanceKm) {
			// Prefer more precise (42.195 over 42.2 over 42)
			const rStr = race.distanceKm.toString();
			const mStr = merged.distanceKm.toString();
			if (rStr.length > mStr.length) merged.distanceKm = race.distanceKm;
		}
		// Keep a longer whyItFits
		if (race.whyItFits && race.whyItFits.length > merged.whyItFits.length) {
			merged.whyItFits = race.whyItFits;
		}
	}

	return merged;
}

/**
 * Deduplicate classified races using the LLM to identify same-race groups.
 */
export async function deduplicateRaces(
	races: ClassifiedRace[],
	onLog: (msg: string) => void
): Promise<ClassifiedRace[]> {
	if (races.length <= 1) return races;

	// Build compact list for the LLM
	const raceList = races.map((r, i) =>
		`[${i}] "${r.name}" — ${r.city}, ${r.country} — ${r.distanceKm ?? '?'}km`
	).join('\n');

	onLog(`🔍 Deduplicating ${races.length} races…`);

	try {
		const { object } = await generateObject({
			model: getModel(),
			system: DEDUP_PROMPT,
			prompt: raceList,
			schema: dedupeSchema,
			schemaName: 'DeduplicationResult',
			schemaDescription: 'Groups of duplicate races identified by index'
		});

		if (object.duplicateGroups.length === 0) {
			onLog('  No duplicates found');
			return races;
		}

		// Track which indices are consumed by a group
		const consumed = new Set<number>();
		const result: ClassifiedRace[] = [];

		for (const group of object.duplicateGroups) {
			const validIndices = group.indices.filter(i => i >= 0 && i < races.length);
			if (validIndices.length < 2) continue;

			const groupRaces = validIndices.map(i => races[i]);
			const merged = mergeGroup(groupRaces, group.canonicalName);
			result.push(merged);
			validIndices.forEach(i => consumed.add(i));
			onLog(`  ↳ merged: ${group.indices.map(i => races[i]?.name).join(' + ')} → "${group.canonicalName}"`);
		}

		// Add all non-consumed races
		for (let i = 0; i < races.length; i++) {
			if (!consumed.has(i)) result.push(races[i]);
		}

		onLog(`  Deduped: ${races.length} → ${result.length} races`);
		return result;
	} catch (err) {
		onLog(`  ⚠️ Dedup failed: ${err instanceof Error ? err.message : String(err)} — keeping all`);
		return races;
	}
}
