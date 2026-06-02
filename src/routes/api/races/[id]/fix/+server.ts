import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { getModel, fetchAndParse } from '$lib/server/agent/enrichment';
import type { RequestHandler } from './$types';

/**
 * Admin "Fix with AI": the admin describes in plain language what is wrong
 * (e.g. "this event only has medals for children", "the date is actually 5 May",
 * "registration is closed now"). An LLM agent interprets the instruction —
 * optionally double-checking the official website — and applies a structured
 * patch to the whitelisted race fields. Only typed columns are ever written.
 */

const SYSTEM = `You are an admin assistant that corrects a running race's stored data.

You are given the CURRENT stored data for one race and a plain-language INSTRUCTION from a trusted admin describing what should change.

Your job:
1. Work out exactly which fields must change to satisfy the instruction.
2. If the instruction asks you to verify or look something up (e.g. "check the website", "find the real date"), you MAY use visit_page on the official website first. Otherwise trust the admin's instruction directly — they know this race.
3. Call apply_changes with ONLY the fields that should change. Leave everything else out — do not resend unchanged values.

Rules:
- Be conservative and literal. Change only what the instruction implies.
- medalStatus is one of: "confirmed" (everyone finishing gets a medal), "likely", "unclear".
  If medals are restricted (e.g. children only, or only top finishers), set medalStatus to "unclear" and put the nuance into medalNote.
- Dates must be YYYY-MM-DD with the correct year. Never invent a day you don't know.
- For race-day practical info (address, start times, bib pickup, toilets/bag storage, food/expo/entertainment), use the raceDayInfo.* fields.
- Always finish by calling apply_changes. If literally nothing needs changing, call apply_changes with an empty patch and explain why in reasoning.`;

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = (await request.json().catch(() => ({}))) as { instruction?: string };
	const instruction = (body.instruction ?? '').trim();
	if (!instruction) error(400, 'Instruction is required');
	if (instruction.length > 1000) error(400, 'Instruction too long');

	const rows = await db
		.select({ distance: raceDistances, edition: raceEditions, series: raceSeries })
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceDistances.id, params.id))
		.limit(1);

	if (rows.length === 0) error(404, 'Race not found');
	const { distance, edition, series } = rows[0];

	const log: string[] = [];
	const changed: string[] = [];

	const existingRdi =
		(edition.raceDayInfo as Record<string, string | null> | null) ?? {};

	const current = {
		name: distance.name,
		eventName: series.name,
		distanceKm: distance.distanceKm,
		surface: distance.surface,
		medalStatus: distance.medalStatus,
		registrationUrl: distance.registrationUrl,
		resultsUrl: distance.resultsUrl,
		raceDate: edition.raceDate ? edition.raceDate.toISOString().split('T')[0] : null,
		location: edition.location,
		registrationStatus: edition.registrationStatus,
		priceMin: edition.priceMin,
		priceMax: edition.priceMax,
		priceCurrency: edition.priceCurrency,
		fieldSize: edition.fieldSize,
		websiteUrl: edition.websiteUrl ?? series.websiteUrl,
		raceDayInfo: existingRdi,
		category: series.category,
		city: series.city,
		country: series.country,
		whyItFits: series.whyItFits
	};

	try {
		await generateText({
			model: getModel(),
			system: SYSTEM,
			prompt: [
				`CURRENT DATA:\n${JSON.stringify(current, null, 2)}`,
				`\nSource URL: ${edition.sourceUrl ?? 'unknown'}`,
				`\nADMIN INSTRUCTION:\n"${instruction}"`
			].join('\n'),
			stopWhen: stepCountIs(4),
			tools: {
				visit_page: tool({
					description:
						'Fetch a web page to verify a fact. Returns page text, structured data, links and images. Only use if the instruction requires looking something up.',
					inputSchema: z.object({
						url: z.string().url().describe('URL to visit'),
						reason: z.string().describe('What you are verifying')
					}),
					execute: async ({ url, reason }) => {
						log.push(`🌐 ${new URL(url).hostname}: ${reason}`);
						const page = await fetchAndParse(url);
						if (!page) return { error: `Could not fetch ${url}` };
						return {
							title: page.title,
							pageText: page.text,
							structuredData: page.structuredData,
							expandableContent: page.expandableContent,
							links: page.links
						};
					}
				}),
				apply_changes: tool({
					description:
						'Apply the corrections. Include ONLY the fields that should change. ALWAYS call this when done.',
					inputSchema: z.object({
						name: z.string().nullable().optional().describe('Distance/event display name'),
						distanceKm: z.number().nullable().optional(),
						surface: z.enum(['road', 'trail', 'mixed', 'track']).nullable().optional(),
						medalStatus: z.enum(['confirmed', 'likely', 'unclear']).nullable().optional(),
						medalNote: z
							.string()
							.nullable()
							.optional()
							.describe('Short clarification about medals, e.g. "Finisher medals for children only". Stored in raceDayInfo.'),
						registrationUrl: z.string().nullable().optional(),
						resultsUrl: z.string().nullable().optional(),
						raceDateIso: z.string().nullable().optional().describe('YYYY-MM-DD with correct year'),
						location: z.string().nullable().optional(),
						registrationStatus: z
							.enum(['open', 'opening_soon', 'closed', 'unknown'])
							.nullable()
							.optional(),
						priceMin: z.number().nullable().optional(),
						priceMax: z.number().nullable().optional(),
						priceCurrency: z.string().nullable().optional(),
						fieldSize: z.number().nullable().optional(),
						websiteUrl: z.string().nullable().optional(),
						category: z.enum(['local', 'norway', 'international']).nullable().optional(),
						city: z.string().nullable().optional(),
						country: z.string().nullable().optional(),
						whyItFits: z.string().nullable().optional(),
						imageUrl: z.string().nullable().optional(),
						raceDayInfo: z
							.object({
								address: z.string().nullable().optional(),
								startTimes: z.string().nullable().optional(),
								bibPickup: z.string().nullable().optional(),
								facilities: z.string().nullable().optional(),
								extras: z.string().nullable().optional()
							})
							.nullable()
							.optional()
							.describe('Practical race-day info fields to set or update'),
						reasoning: z.string().describe('Brief explanation of what you changed and why')
					}),
					execute: async (p) => {
						const distanceSet: Record<string, unknown> = {};
						const editionSet: Record<string, unknown> = {};
						const seriesSet: Record<string, unknown> = {};

						if (p.name != null) { distanceSet.name = p.name; changed.push(`name → ${p.name}`); }
						if (p.distanceKm != null) { distanceSet.distanceKm = p.distanceKm; changed.push(`distanceKm → ${p.distanceKm}`); }
						if (p.surface != null) { distanceSet.surface = p.surface; changed.push(`surface → ${p.surface}`); }
						if (p.medalStatus != null) { distanceSet.medalStatus = p.medalStatus; changed.push(`medalStatus → ${p.medalStatus}`); }
						if (p.registrationUrl != null) { distanceSet.registrationUrl = p.registrationUrl; changed.push('registrationUrl'); }
						if (p.resultsUrl != null) { distanceSet.resultsUrl = p.resultsUrl; changed.push('resultsUrl'); }

						if (p.raceDateIso != null) { editionSet.raceDate = new Date(p.raceDateIso); changed.push(`raceDate → ${p.raceDateIso}`); }
						if (p.location != null) { editionSet.location = p.location; changed.push(`location → ${p.location}`); }
						if (p.registrationStatus != null) { editionSet.registrationStatus = p.registrationStatus; changed.push(`registrationStatus → ${p.registrationStatus}`); }
						if (p.priceMin != null) { editionSet.priceMin = p.priceMin; changed.push(`priceMin → ${p.priceMin}`); }
						if (p.priceMax != null) { editionSet.priceMax = p.priceMax; changed.push(`priceMax → ${p.priceMax}`); }
						if (p.priceCurrency != null) { editionSet.priceCurrency = p.priceCurrency; changed.push(`priceCurrency → ${p.priceCurrency}`); }
						if (p.fieldSize != null) { editionSet.fieldSize = p.fieldSize; changed.push(`fieldSize → ${p.fieldSize}`); }
						if (p.websiteUrl != null) { editionSet.websiteUrl = p.websiteUrl; changed.push('websiteUrl'); }

						// Merge race-day info (incl. medal note) into the existing object
						const rdi: Record<string, string | null> = { ...existingRdi };
						let rdiTouched = false;
						if (p.raceDayInfo) {
							for (const [k, v] of Object.entries(p.raceDayInfo)) {
								if (v != null) { rdi[k] = v; rdiTouched = true; changed.push(`raceDayInfo.${k}`); }
							}
						}
						if (p.medalNote != null) { rdi.medalNote = p.medalNote; rdiTouched = true; changed.push('medalNote'); }
						if (rdiTouched) editionSet.raceDayInfo = rdi;

						if (p.category != null) { seriesSet.category = p.category; changed.push(`category → ${p.category}`); }
						if (p.city != null) { seriesSet.city = p.city; changed.push(`city → ${p.city}`); }
						if (p.country != null) { seriesSet.country = p.country; changed.push(`country → ${p.country}`); }
						if (p.whyItFits != null) { seriesSet.whyItFits = p.whyItFits; changed.push('whyItFits'); }
						if (p.imageUrl != null) { seriesSet.imageUrl = p.imageUrl; changed.push('imageUrl'); }

						if (Object.keys(distanceSet).length > 0) {
							distanceSet.lastUpdatedAt = new Date();
							await db.update(raceDistances).set(distanceSet).where(eq(raceDistances.id, params.id));
						}
						if (Object.keys(editionSet).length > 0) {
							editionSet.lastUpdatedAt = new Date();
							await db.update(raceEditions).set(editionSet).where(eq(raceEditions.id, edition.id));
						}
						if (Object.keys(seriesSet).length > 0) {
							seriesSet.lastUpdatedAt = new Date();
							await db.update(raceSeries).set(seriesSet).where(eq(raceSeries.id, series.id));
						}

						log.push(`📋 ${p.reasoning}`);
						return { applied: true, changedCount: changed.length };
					}
				})
			}
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.push(`⚠️ ${msg}`);
		error(500, `AI fix failed: ${msg}`);
	}

	if (changed.length === 0) log.push('No changes were applied.');

	return json({ ok: true, changed, log });
};
