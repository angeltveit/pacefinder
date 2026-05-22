import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { RawRaceLead, ClassifiedRace } from './types';

const SYSTEM_PROMPT = `You are a running race research assistant for a user based in Bergen, Norway.
Your job is to classify and enrich race leads according to strict relevance rules.

INCLUDE:
- LOCAL: 5K or 10K races within ~90 minutes of Bergen City Center, with a confirmed or likely finisher medal
- NORWAY: Half marathons in Oslo, Trondheim, Stavanger, Tromsø, Ålesund, Kristiansand, Bodø, or Bodø — travel-worthy with a medal
- INTERNATIONAL: Major marathons (Berlin, London, New York, Chicago, Tokyo, Boston, Paris, Valencia), iconic/scenic halfs, bucket-list routes with strong medal or prestige

EXCLUDE:
- Virtual races
- Training runs / mosjonsløp without medals
- Kids-only races
- Races with no registration info
- Random small foreign races with no special angle

For medal_status, use:
- "confirmed" if the event page explicitly states a medal
- "likely" if it's a well-known event type that typically awards medals
- "unclear" if you cannot determine medal status

Return ONLY races that pass the inclusion criteria. Return an empty array if nothing qualifies.`;

const raceSchema = z.object({
	races: z.array(
		z.object({
			name: z.string(),
			category: z.enum(['local', 'norway', 'international']),
			distanceKm: z.number().nullable(),
			location: z.string().nullable(),
			city: z.string(),
			country: z.string().default('NO'),
			raceDateIso: z.string().nullable().describe('ISO 8601 date string or null'),
			registrationUrl: z.string().url().nullable(),
			sourceUrl: z.string().url(),
			medalStatus: z.enum(['confirmed', 'likely', 'unclear']),
			registrationStatus: z.enum(['open', 'opening_soon', 'unknown', 'closed']),
			whyItFits: z.string().describe('1–2 sentence explanation of why this race is relevant')
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
		system: SYSTEM_PROMPT,
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
		raceDate: r.raceDateIso ? new Date(r.raceDateIso) : null,
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
