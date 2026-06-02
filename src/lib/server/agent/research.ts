import { env } from '$env/dynamic/private';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { getModel, fetchAndParse, tavilyImageSearch } from '$lib/server/agent/enrichment';
import { upsertClassifiedRace } from '$lib/server/agent';
import type { ClassifiedRace } from '$lib/server/agent/types';

/**
 * Shared "find a race on the web and import it" agent. Used by the admin
 * free-text importer and by the AI coach's find_and_add_race tool so both get
 * the exact same robust multi-step research (web search → visit official site,
 * following internal links → image search → upsert).
 */

const SYSTEM = `You are a research agent that finds a running race on the web and imports it into a Nordic race-discovery app.

You are given a free-text RACE QUERY (a race name, possibly with a city or year). Your job:
1. Use web_search to locate the race's OFFICIAL website (not aggregator/timing calendars when an official site exists). Try multiple phrasings if the first search is weak (e.g. add the city, country, "lopp"/"løp"/"race", or the year).
2. Use visit_page on the official site (and follow internal links like "Program", "Praktisk info", "Påmelding"/"Anmälan", "Premiering", "Distanser"/"Distanser & priser") to gather the facts.
3. Use search_images if the official og:image is a logo/graphic — pick a real photo of RUNNERS IN ACTION (crowd, pack, start/finish). Never a logo, map, or medal.
4. Call add_race ONCE with everything you found. ALWAYS finish by calling add_race.

Rules:
- Be persistent. Many smaller Nordic races only show up on club sites, Facebook events, or timing/registration platforms (e.g. raceid.com, deltager.no, eqtiming, sportstiming, ultrasignup). If the official site is thin, gather what you can from those.
- DATE: report the UPCOMING edition's date as YYYY-MM-DD with the correct year. It must be today or later. If only a past edition or a month/season (no exact day) is shown, set raceDateIso to null — never fabricate a day or roll a past date forward.
- DISTANCES: list every distance offered in km, e.g. [5, 10, 21.1]. The app creates one entry per distance.
- CATEGORY: "norway" for races in Norway, "international" for races outside the Nordics or world-famous bucket-list races, "local" for small local Nordic events.
- COUNTRY: ISO 2-letter code (NO, SE, DK, FI, IS, etc.). CITY: the host city.
- MEDAL: "confirmed" if a finisher medal is clearly mentioned, "likely" for an established named race, "unclear" otherwise (or if medals are restricted).
- Report ONLY facts you actually found. Leave a field null/empty rather than guessing.
- Only set found=false if, after trying several searches, you genuinely cannot identify the race. Explain why in reasoning.`;

type SearchResult = { title: string; url: string; content: string };

async function tavilySearch(query: string): Promise<SearchResult[]> {
	if (!env.TAVILY_API_KEY) return [];
	try {
		const res = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				query,
				search_depth: 'advanced',
				max_results: 6
			}),
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { results?: SearchResult[] };
		return (data.results ?? []).map((r) => ({
			title: r.title,
			url: r.url,
			content: (r.content ?? '').slice(0, 600)
		}));
	} catch {
		return [];
	}
}

export type ImportedRace = {
	name: string;
	city: string;
	isNew: boolean;
	distances: number;
	editionId: string;
	primaryDistanceId: string | null;
};

export type ResearchResult = {
	imported: ImportedRace | null;
	notFoundReason: string | null;
};

/**
 * Research a race from a free-text query and import it. `onLog` receives
 * progress lines. `sourceTag` labels the import origin (e.g. 'admin-import', 'coach').
 */
export async function researchAndImportRace(
	query: string,
	onLog: (msg: string) => void = () => {},
	sourceTag = 'agent-import'
): Promise<ResearchResult> {
	let imported: ImportedRace | null = null;
	let notFoundReason: string | null = null;

	await generateText({
		model: getModel(),
		system: SYSTEM,
		prompt: `RACE QUERY: ${query}\n\nFind this race and import it. Today is ${new Date().toISOString().split('T')[0]}.`,
		stopWhen: stepCountIs(14),
		tools: {
			web_search: tool({
				description:
					'Search the web for the race. Returns title, url and a content snippet for each result. Use this first to find the official website; retry with different phrasings if results are weak.',
				inputSchema: z.object({
					query: z.string().describe('Search query, e.g. "Hermanövarvet Orust lopp 2026"')
				}),
				execute: async ({ query: q }) => {
					onLog(`  🌐 search: "${q}"`);
					const results = await tavilySearch(q);
					if (results.length === 0)
						return { results: [], note: 'No results. Try a different query.' };
					return { results };
				}
			}),
			visit_page: tool({
				description:
					'Fetch a web page. Returns title, page text, embedded structured data, accordion/FAQ content, navigation menu and links. Follow internal links to gather missing facts.',
				inputSchema: z.object({
					url: z.string().url().describe('URL to visit'),
					reason: z.string().describe('What you are looking for')
				}),
				execute: async ({ url, reason }) => {
					onLog(`  📄 ${new URL(url).hostname}: ${reason}`);
					const page = await fetchAndParse(url);
					if (!page) return { error: `Could not fetch ${url}` };
					return {
						title: page.title,
						description: page.metaDescription,
						pageText: page.text,
						structuredData: page.structuredData,
						expandableContent: page.expandableContent,
						ogImage: page.ogImage,
						navigationMenu: page.navLinks,
						links: page.links
					};
				}
			}),
			search_images: tool({
				description:
					'Search for a real photo of runners at this race. Use only if the official og:image is a logo/graphic. Prefer crowd/pack shots with a landmark.',
				inputSchema: z.object({
					query: z
						.string()
						.describe('e.g. "Hermanövarvet Orust runners crowd start line" — include "runners"')
				}),
				execute: async ({ query: q }) => {
					onLog(`  🖼️ image search: "${q}"`);
					const images = await tavilyImageSearch(q);
					if (images.length === 0) return { images: [], note: 'No images. Try another query.' };
					return { images };
				}
			}),
			add_race: tool({
				description:
					'Import the race. ALWAYS call this exactly once when done. Set found=false if you could not identify the race.',
				inputSchema: z.object({
					found: z.boolean().describe('True if you identified the race and have data to import.'),
					name: z.string().nullable().describe('Display name of the event, e.g. "Hermanövarvet".'),
					eventName: z
						.string()
						.nullable()
						.describe('Base event name without distance suffix or year, e.g. "Hermanövarvet".'),
					category: z.enum(['local', 'norway', 'international']).nullable(),
					city: z.string().nullable(),
					country: z.string().nullable().describe('ISO 2-letter code, e.g. "SE".'),
					location: z.string().nullable().describe('Venue / start-finish area if known.'),
					distancesKm: z
						.array(z.number())
						.nullable()
						.describe('All distances offered in km, e.g. [5, 10, 21.1].'),
					raceDateIso: z
						.string()
						.nullable()
						.describe('Upcoming edition date YYYY-MM-DD (today or later), else null.'),
					websiteUrl: z.string().nullable(),
					registrationUrl: z.string().nullable(),
					resultsUrl: z.string().nullable().optional(),
					imageUrl: z
						.string()
						.nullable()
						.describe('A real photo of runners in action. Never a logo/graphic.'),
					medalStatus: z.enum(['confirmed', 'likely', 'unclear']).nullable(),
					registrationStatus: z.enum(['open', 'opening_soon', 'unknown', 'closed']).nullable(),
					priceMin: z.number().nullable().optional(),
					priceMax: z.number().nullable().optional(),
					priceCurrency: z.string().nullable().optional(),
					fieldSize: z.number().nullable().optional(),
					elevationGainM: z.number().nullable().optional(),
					surface: z.enum(['road', 'trail', 'mixed', 'track']).nullable().optional(),
					raceDayInfo: z
						.object({
							address: z.string().nullable().optional(),
							startTimes: z.string().nullable().optional(),
							bibPickup: z.string().nullable().optional(),
							facilities: z.string().nullable().optional(),
							extras: z.string().nullable().optional()
						})
						.nullable()
						.optional(),
					whyItFits: z
						.string()
						.nullable()
						.describe('1–2 punchy sentences on what makes this race interesting.'),
					reasoning: z.string().describe('Brief summary of what you found, or why not found.')
				}),
				execute: async (f) => {
					if (!f.found || !f.eventName || !f.city || !f.country) {
						notFoundReason = f.reasoning || 'Could not identify the race.';
						onLog(`  ✗ ${notFoundReason}`);
						return { ok: false, reason: notFoundReason };
					}

					const distances = (f.distancesKm ?? []).filter((d) => typeof d === 'number');
					const raceDate = f.raceDateIso ? new Date(f.raceDateIso) : null;

					const race: ClassifiedRace = {
						name: f.name ?? f.eventName,
						eventName: f.eventName,
						category: f.category ?? 'norway',
						distanceKm: distances[0] ?? null,
						enrichedDistancesKm: distances.length > 1 ? distances : undefined,
						location: f.location ?? null,
						city: f.city,
						country: f.country,
						raceDate,
						registrationUrl: f.registrationUrl ?? null,
						resultsUrl: f.resultsUrl ?? null,
						websiteUrl: f.websiteUrl ?? null,
						imageUrl: f.imageUrl ?? null,
						sourceUrl: f.websiteUrl ?? f.registrationUrl ?? sourceTag,
						medalStatus: f.medalStatus ?? 'unclear',
						registrationStatus: f.registrationStatus ?? 'unknown',
						priceMin: f.priceMin ?? null,
						priceMax: f.priceMax ?? null,
						priceCurrency: f.priceCurrency ?? null,
						fieldSize: f.fieldSize ?? null,
						elevationGainM: f.elevationGainM ?? null,
						surface: f.surface ?? null,
						raceDayInfo: f.raceDayInfo ?? null,
						whyItFits: f.whyItFits ?? '',
						rawLlmOutput: f,
						fingerprint: `${f.eventName}|${f.city}`.toLowerCase()
					};

					const { isNew, editionId, primaryDistanceId } = await upsertClassifiedRace(
						race,
						onLog
					);
					imported = {
						name: race.name,
						city: race.city,
						isNew,
						distances: distances.length > 1 ? distances.length : 1,
						editionId,
						primaryDistanceId
					};
					onLog(`  ✓ ${isNew ? 'Imported' : 'Updated'} ${race.name} (${race.city})`);
					return { ok: true, isNew };
				}
			})
		}
	});

	return { imported, notFoundReason };
}
