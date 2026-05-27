import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { RawRaceLead, ClassifiedRace } from './types';

const SYSTEM_PROMPT = () => `You are a running race classifier for a Nordic race discovery app.
Your job is to process scraped race leads from timing systems across Norway, Sweden, Denmark, Finland, and Iceland.
Today's date: ${new Date().toISOString().split('T')[0]}. Use this to resolve relative dates and filter out past events.

CRITICAL RULES FOR DATES:
- ALWAYS look for exact dates in the source text. Dates appear as "14. juni 2026", "June 14, 2026", "14.06.2026", "2026-06-14", "30. maí" etc.
- If a month/year is mentioned but not an exact day, use the 1st of that month.
- NEVER return null for raceDateIso if there is ANY date information in the source text.
- Only return null if genuinely zero date info exists.

INCLUDE — all of these:
- Running races 3km and above (3K, 5K, 10K, half marathon, marathon, ultra)
- Trail runs
- Obstacle/mud runs (if primarily running-based)
- Relay races that are running-based

EXCLUDE — filter these OUT:
- Non-running sports: triathlons, duathlons, cycling, swimming, skiing, orienteering, walking, dog sledding, HYROX
- Recurring weekly/monthly casual "runclub" jogs (e.g. "Løpeserie uke 12", "Parkrun", weekly training runs, "Hlaupasería" monthly series)
- Virtual races
- Kids-only races (under 12)
- Past races (race date before today)
- Races under 3km

HOW TO DETECT RUNCLUB/RECURRING:
- Monthly numbered series (e.g. "(Mars)", "(Janúar)", "uke 5")
- "Powerade vetrarhlaupið" numbered series — these ARE real races, INCLUDE them
- Weekly parkruns or "Lørdagsløp" without specific event names
- Events with names like "Treningsløp", "Tirsdagsløp", "Onsdagsløp" suggesting weekday jogs

MULTI-DISTANCE EVENTS:
- If a race offers multiple distances (e.g. 5K AND 10K), output a SEPARATE object for EACH distance.
- Example: "Oslo Maraton" with 10K, half, and full → THREE objects.
- If you can't determine specific distances, output one object with distanceKm = null.

For medal_status:
- "confirmed" if explicitly mentioned (medal, medalje, verðlaun)
- "likely" if it's a named race event with registration fee and official organization (most named 10K+ races give medals)
- "unclear" if small local event or genuinely unknown

For country:
- Infer from the source (eqtiming=NO/SE, sportstiming=DK/SE, timataka=IS, racetimer=SE, kondis=NO, friidrett=NO)
- If city is mentioned, use that to determine country
- Use ISO 2-letter codes: NO, SE, DK, FI, IS

Return ALL qualifying races. Do NOT filter by region — include everything from all Nordic countries.`;

const raceSchema = z.object({
	races: z.array(
		z.object({
			name: z.string(),
			eventName: z.string().describe('Base event name WITHOUT distance suffix or year. E.g. "Oslo Maraton" not "Oslo Maraton – 10K". Strip sponsor prefixes.'),
			distanceKm: z.number().nullable(),
			location: z.string().nullable(),
			city: z.string(),
			country: z.string().describe('ISO 2-letter country code: NO, SE, DK, FI, IS'),
			raceDateIso: z.string().nullable().describe('ISO 8601 date string or null'),
			registrationUrl: z.string().nullable().describe('Direct registration/signup URL if found'),
			websiteUrl: z.string().nullable().describe('Official race website URL (not the aggregator page)'),
			medalStatus: z.enum(['confirmed', 'likely', 'unclear']),
			registrationStatus: z.enum(['open', 'opening_soon', 'unknown', 'closed']),
			whyItFits: z.string().describe('1–2 punchy sentences about what makes this race interesting. Mention medal, distance, scenery, or vibe.')
		})
	)
});

function getModel() {
	const provider = env.LLM_PROVIDER ?? 'openai';
	const model = env.LLM_MODEL ?? 'gpt-4o-mini';
	const apiKey = env.LLM_API_KEY;

	if (provider === 'anthropic') {
		return createAnthropic({ apiKey })(model);
	}
	// Default: OpenAI-compatible
	return createOpenAI({ apiKey, baseURL: env.LLM_BASE_URL })(model);
}

function fingerprint(name: string, city: string, dateIso: string | null): string {
	const slug = [name, city, dateIso ?? '']
		.join('|')
		.toLowerCase()
		.replace(/[^a-z0-9|]/g, '-');
	return slug;
}

const BATCH_SIZE = 15;

export async function classifyRaces(leads: RawRaceLead[]): Promise<{
	classified: ClassifiedRace[];
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
}> {
	const classified: ClassifiedRace[] = [];
	let tokensIn = 0;
	let tokensOut = 0;
	let costUsd = 0;
	await classifyRacesBatched(leads, (batch) => { classified.push(...batch); });
	// Recalculate totals — this path is kept for backward compat but prefer classifyRacesBatched
	return { classified, tokensIn, tokensOut, costUsd };
}

/**
 * Classify leads in batches, calling onBatch with each batch of results as soon as
 * the LLM returns them. This allows the caller to persist races incrementally.
 */
export async function classifyRacesBatched(
	leads: RawRaceLead[],
	onBatch: (races: ClassifiedRace[], stats: { tokensIn: number; tokensOut: number; costUsd: number }) => void | Promise<void>
): Promise<{ tokensIn: number; tokensOut: number; costUsd: number }> {
	if (leads.length === 0) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };

	// Split into chunks to stay within model output token limits
	const chunks: RawRaceLead[][] = [];
	for (let i = 0; i < leads.length; i += BATCH_SIZE) {
		chunks.push(leads.slice(i, i + BATCH_SIZE));
	}

	const inputPricePer1M = 0.15;
	const outputPricePer1M = 0.6;

	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let totalCost = 0;

	for (const chunk of chunks) {
		const prompt = chunk
			.map(
				(l, i) =>
					`[${i + 1}] ${l.name}\nSource: ${l.source} | ${l.url}\n${l.description ?? ''}\n${l.rawText ?? ''}`
			)
			.join('\n\n---\n\n');

		const { object, usage } = await generateObject({
			model: getModel(),
			mode: 'json',
			system: SYSTEM_PROMPT(),
			prompt,
			schema: raceSchema,
			schemaName: 'RaceClassification',
			schemaDescription: 'Classified running races extracted from scraped leads',
			maxTokens: 8000
		});

		const batchTokensIn = usage.promptTokens ?? 0;
		const batchTokensOut = usage.completionTokens ?? 0;
		const batchCost =
			(batchTokensIn * inputPricePer1M + batchTokensOut * outputPricePer1M) / 1_000_000;

		totalTokensIn += batchTokensIn;
		totalTokensOut += batchTokensOut;
		totalCost += batchCost;

		// Build url→lead map so we can inject sourceUrl without asking the LLM to echo it
		const urlMap = new Map(chunk.map((l) => [l.url, l]));
		const batchRaces: ClassifiedRace[] = [];

		for (const r of object.races) {
			const sourceLead = (r.websiteUrl ? urlMap.get(r.websiteUrl) : undefined) ?? chunk[0];
			batchRaces.push({
				...r,
				category: inferCategory(r.country, r.city, r.distanceKm),
				eventName: r.eventName ?? r.name,
				raceDate: r.raceDateIso ? new Date(r.raceDateIso) : null,
				websiteUrl: r.websiteUrl ?? null,
				sourceUrl: sourceLead.url,
				resultsUrl: null,
				imageUrl: null,
				rawLlmOutput: r,
				fingerprint: fingerprint(r.name, r.city, r.raceDateIso)
			});
		}

		await onBatch(batchRaces, { tokensIn: batchTokensIn, tokensOut: batchTokensOut, costUsd: batchCost });
	}

	return { tokensIn: totalTokensIn, tokensOut: totalTokensOut, costUsd: totalCost };
}

/**
 * Infer category based on country. This is now done in code, not by the LLM.
 * The app can later use this + user location to filter in the UI.
 */
function inferCategory(country: string, _city: string, _distanceKm: number | null): 'local' | 'norway' | 'international' {
	// For now: NO = norway, everything else = international
	// "local" category will be determined per-user in the app layer
	if (country === 'NO') return 'norway';
	return 'international';
}
