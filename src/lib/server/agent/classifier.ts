import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { RawRaceLead, ClassifiedRace } from './types';

const SYSTEM_PROMPT = () => `You are a running race research assistant for a user based in Bergen, Norway.
Your job is to classify and enrich race leads according to strict relevance rules.
Today's date: ${new Date().toISOString().split('T')[0]}. Use this to resolve relative dates and filter out past events.

CRITICAL RULES FOR DATES:
- ALWAYS look for exact dates in the source text. Dates appear as "14. juni 2026", "June 14, 2026", "14.06.2026", "2026-06-14" etc.
- If a month/year is mentioned but not an exact day, use the 1st of that month (e.g. "juni 2026" → "2026-06-01").
- NEVER return null for raceDateIso if there is ANY date information in the source text.
- Only return null if genuinely zero date info exists.

CRITICAL RULES FOR URLS:
- websiteUrl should be the race's OWN official website (not kondis.no, friidrett.no, or the search result page).
- If the source text contains a URL to the race's own domain, always include it as websiteUrl.
- registrationUrl should be the direct signup/entry form page if visible.

INCLUDE:
- LOCAL: Any running race within ~90 minutes of Bergen City Center with a finisher medal (confirmed or likely). This includes 5K, 10K, half marathon, marathon, obstacle runs, trail runs — any distance.
- NORWAY: Half marathons and marathons in major Norwegian cities (Oslo, Trondheim, Stavanger, Tromsø, Ålesund, Kristiansand, Bodø, Bergen, Drammen, Fredrikstad, Haugesund) — travel-worthy with a medal.
- INTERNATIONAL: Major marathons (Berlin, London, New York, Chicago, Tokyo, Boston, Paris, Valencia, Stockholm, Copenhagen, Amsterdam), iconic/scenic halfs, bucket-list routes with strong medal or prestige.

EXCLUDE:
- Virtual races
- Training runs / mosjonsløp explicitly without medals
- Kids-only races
- Past races (race date before today)
- Races with absolutely no registration info

MULTI-DISTANCE EVENTS: If an event offers multiple qualifying distances (e.g. both 5K and 10K, or half and full marathon), create a SEPARATE entry for EACH qualifying distance with the correct distanceKm.

For medal_status:
- "confirmed" if the event page explicitly states a medal
- "likely" if it is a named race event (not a mosjonsløp), especially with registration fees or club organisation — most real races give medals
- "unclear" only if you genuinely have no information

For whyItFits:
- Be punchy, fun, specific. Not bureaucratic.
- Good: "Close enough that you can't make excuses. Medal likely."
- Good: "High story value. Arctic scenery with low crowd density."
- Bad: "A named Bergen road race organised under Norges Friidrettsforbund..."

Be INCLUSIVE: when in doubt about a local Bergen-area race, include it with medal_status "likely". It is better to include a borderline race than to miss it.

Return ONLY races that pass the inclusion criteria. Return an empty array if nothing qualifies.`;

const raceSchema = z.object({
	races: z.array(
		z.object({
			name: z.string(),
			eventName: z.string().describe('Base event name WITHOUT distance suffix or year. E.g. "Bergen City Marathon" not "Bergen City Marathon – 5K". Strip sponsor prefixes for clean grouping.'),
			category: z.enum(['local', 'norway', 'international']),
			distanceKm: z.number().nullable(),
			location: z.string().nullable(),
			city: z.string(),
			country: z.string().default('NO'),
			raceDateIso: z.string().nullable().describe('ISO 8601 date string or null — look carefully in the source text for exact dates'),
			registrationUrl: z.string().nullable().describe('Direct registration/signup URL if found'),
			websiteUrl: z.string().nullable().describe('Official race website URL (not the source/aggregator page)'),
			sourceUrl: z.string(),
			medalStatus: z.enum(['confirmed', 'likely', 'unclear']),
			registrationStatus: z.enum(['open', 'opening_soon', 'unknown', 'closed']),
			whyItFits: z.string().describe('1–2 punchy sentences. Be specific about why this race is worth attention. Mention medal, distance, scenery, travel value, or bragging rights.')
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

export async function classifyRaces(leads: RawRaceLead[]): Promise<{
	classified: ClassifiedRace[];
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
}> {
	if (leads.length === 0) return { classified: [], tokensIn: 0, tokensOut: 0, costUsd: 0 };

	const prompt = leads
		.map(
			(l, i) =>
				`[${i + 1}] ${l.name}\nSource: ${l.url}\n${l.description ?? ''}\n${l.rawText ?? ''}`
		)
		.join('\n\n---\n\n');

	const { object, usage } = await generateObject({
		model: getModel(),
		system: SYSTEM_PROMPT(),
		prompt,
		schema: raceSchema
	});

	// Estimate cost (configurable price table — defaults to gpt-4o-mini pricing)
	const inputPricePer1M = 0.15;
	const outputPricePer1M = 0.6;
	const costUsd =
		((usage.promptTokens ?? 0) * inputPricePer1M +
			(usage.completionTokens ?? 0) * outputPricePer1M) /
		1_000_000;

	const classified: ClassifiedRace[] = object.races.map((r) => ({
		...r,
		eventName: r.eventName ?? r.name,
		raceDate: r.raceDateIso ? new Date(r.raceDateIso) : null,
		websiteUrl: r.websiteUrl ?? null,
		imageUrl: null,
		rawLlmOutput: r,
		fingerprint: fingerprint(r.name, r.city, r.raceDateIso)
	}));

	return {
		classified,
		tokensIn: usage.promptTokens ?? 0,
		tokensOut: usage.completionTokens ?? 0,
		costUsd
	};
}
