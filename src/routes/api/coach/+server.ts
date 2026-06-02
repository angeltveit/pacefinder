import { json, error } from '@sveltejs/kit';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { and, asc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, user } from '$lib/server/db/schema';
import { getModel } from '$lib/server/agent/enrichment';
import { researchAndImportRace } from '$lib/server/agent/research';
import { isFeatureEnabled } from '$lib/server/featureFlags';
import { nicknamesByGender } from '$lib/coach/coachText';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

type RaceRef = {
	id: string; // distance id → /races/[id]
	name: string;
	city: string | null;
	country: string | null;
	category: string;
	distanceKm: number | null;
	date: string | null; // ISO yyyy-mm-dd
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Resolved user location used for "near me" queries. */
type Place = {
	label: string; // human readable, e.g. "Bergen, Vestland, Norway"
	city: string | null;
	region: string | null;
	country: string | null;
	lat: number;
	lng: number;
	radiusKm: number;
	source: 'live' | 'home';
};

const NEAR_RADIUS_KM = 80;

/** Reverse-geocode coordinates to a place name via OpenStreetMap Nominatim (free, no key). */
async function reverseGeocode(
	lat: number,
	lng: number
): Promise<{ city: string | null; region: string | null; country: string | null } | null> {
	try {
		const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
		const res = await fetch(url, {
			headers: { 'User-Agent': 'PaceFinder/1.0 (race discovery app)' },
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			address?: {
				city?: string;
				town?: string;
				village?: string;
				municipality?: string;
				state?: string;
				county?: string;
				country?: string;
			};
		};
		const a = data.address ?? {};
		return {
			city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
			region: a.state ?? a.county ?? null,
			country: a.country ?? null
		};
	} catch {
		return null;
	}
}

function buildSystem(
	gender: string | null | undefined,
	name: string | null,
	place: Place | null
): string {
	const pool =
		gender === 'male'
			? nicknamesByGender.male
			: gender === 'female'
				? nicknamesByGender.female
				: nicknamesByGender.neutral;
	const first = (name ?? '').trim().split(/\s+/)[0] || 'champ';

	const locationBlock = place
		? `\nUSER LOCATION (consented):
- The user is near ${place.label}${place.city ? ` (city: ${place.city})` : ''}.
- Coordinates: ${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}. "Near me" = within ${place.radiusKm} km of here.
- When they ask for races "near me" / "nearby", treat "${place.city ?? place.label}" as the search location.`
		: `\nUSER LOCATION: unknown. If the user asks for races "near me" specifically (their own position), tell them to tap the 📍 location button. For any NAMED place (a city, region, country, island, etc.) you do NOT need their location — just search the web for that place.`;

	return `You are "Coach", an over-the-top, hype, gym-bro / gym-sis running coach inside a Nordic race-discovery app. You help runners find and add races, and you pump them up.

PERSONALITY:
- High energy, encouraging, a little ridiculous, emoji-friendly (but don't overdo it — 1-2 per message).
- Call the user playful nicknames. Good options for this user: ${pool.join(', ')}. Their first name is "${first}".
- Keep replies SHORT and punchy — 1-3 sentences. You're a coach between sets, not an essay writer.
- Never invent races or race facts. If you don't know, use your tools.

CAPABILITIES (tools):
- search_races: search OUR database for races (by distance, time window, city, category). Use this FIRST for any "find me a race" request.
- web_discover_races: freely search the WEB for races in ANY place or area the user names — a city, region, country, island, etc. (e.g. "Crete in August", "around Lalleröd late July", "Sweden in summer"). You do NOT need a specific race name to use this. Use it whenever our database has nothing for the area/timeframe the user wants. It returns candidate races with links.
- find_and_add_race: research ONE specific race (by name, or a candidate you found via web_discover_races) and add it to our database. After adding, tell the user it's been added and point them to the link that appears below your message.
${locationBlock}

HOW TO HANDLE A "FIND ME RACES" REQUEST:
1. Call search_races first (use city/distance/time filters the user gave).
2. If it returns nothing useful, call web_discover_races with the place name and timeframe the user mentioned — you are ALLOWED to browse the web freely for any location. Do not ask the user for a race name first.
3. Pick the best 1-3 candidates from the web results and call find_and_add_race for each, then hype them up. Open the first one for the user.

RULES:
- You CAN freely discover races on the web for any location, region, country or timeframe the user describes — never tell the user you can only look up races by name.
- When search_races returns results, hype them up briefly and let the UI show the cards — don't dump a giant list in text.
- Today's date is ${new Date().toISOString().split('T')[0]}. Never promise a race exists without checking.
- Be concise. Always sound like an encouraging coach.`;
}

// ── DB race search ───────────────────────────────────────────────────────────
async function searchRaces(opts: {
	distanceMinKm?: number | null;
	distanceMaxKm?: number | null;
	withinDays?: number | null;
	city?: string | null;
	category?: 'local' | 'norway' | 'international' | null;
	text?: string | null;
}): Promise<RaceRef[]> {
	const now = new Date();
	now.setHours(0, 0, 0, 0);

	const conditions = [gte(raceEditions.raceDate, now)];

	if (opts.distanceMinKm != null) conditions.push(gte(raceDistances.distanceKm, opts.distanceMinKm));
	if (opts.distanceMaxKm != null) conditions.push(lte(raceDistances.distanceKm, opts.distanceMaxKm));
	if (opts.withinDays != null) {
		const until = new Date(now);
		until.setDate(until.getDate() + opts.withinDays);
		conditions.push(lte(raceEditions.raceDate, until));
	}
	if (opts.category) conditions.push(eq(raceSeries.category, opts.category));
	if (opts.city) conditions.push(ilike(raceSeries.city, `%${opts.city}%`));
	if (opts.text) {
		const t = `%${opts.text}%`;
		const textCond = or(ilike(raceSeries.name, t), ilike(raceDistances.name, t), ilike(raceSeries.city, t));
		if (textCond) conditions.push(textCond);
	}

	const rows = await db
		.select({
			id: raceDistances.id,
			distanceKm: raceDistances.distanceKm,
			seriesName: raceSeries.name,
			city: raceSeries.city,
			country: raceSeries.country,
			category: raceSeries.category,
			raceDate: raceEditions.raceDate
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(and(...conditions))
		.orderBy(asc(raceEditions.raceDate), asc(raceDistances.distanceKm))
		.limit(8);

	return rows.map((r) => ({
		id: r.id,
		name: r.seriesName,
		city: r.city,
		country: r.country,
		category: r.category,
		distanceKm: r.distanceKm,
		date: r.raceDate ? r.raceDate.toISOString().split('T')[0] : null
	}));
}

// ── Web search helper (Tavily) ───────────────────────────────────────────────
async function tavilySearch(query: string) {
	if (!env.TAVILY_API_KEY) return [] as { title: string; url: string; content: string }[];
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
		const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
		return (data.results ?? []).map((r) => ({
			title: r.title,
			url: r.url,
			content: (r.content ?? '').slice(0, 600)
		}));
	} catch {
		return [];
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Login required');
	const enabled = await isFeatureEnabled(locals.user.id, 'ai_coach');
	if (!enabled) error(403, 'Coach not enabled for this account');

	const body = (await request.json().catch(() => ({}))) as {
		messages?: ChatMessage[];
		location?: { lat?: number; lng?: number };
	};
	const messages = (body.messages ?? [])
		.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
		.slice(-12)
		.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

	if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
		error(400, 'Expected a user message');
	}

	// ── Resolve the user's location (consented live coords, else stored home) ──
	let place: Place | null = null;
	const liveLat = body.location?.lat;
	const liveLng = body.location?.lng;
	if (typeof liveLat === 'number' && typeof liveLng === 'number' && Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
		const geo = await reverseGeocode(liveLat, liveLng);
		const label = geo
			? [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'your location'
			: 'your location';
		place = {
			label,
			city: geo?.city ?? null,
			region: geo?.region ?? null,
			country: geo?.country ?? null,
			lat: liveLat,
			lng: liveLng,
			radiusKm: NEAR_RADIUS_KM,
			source: 'live'
		};
	} else {
		// Fall back to the user's saved home location if available.
		const me = await db.query.user.findFirst({
			where: eq(user.id, locals.user.id),
			columns: { homeLat: true, homeLng: true, city: true, country: true }
		});
		if (me?.homeLat != null && me?.homeLng != null) {
			place = {
				label: [me.city, me.country].filter(Boolean).join(', ') || 'your home area',
				city: me.city ?? null,
				region: null,
				country: me.country ?? null,
				lat: me.homeLat,
				lng: me.homeLng,
				radiusKm: NEAR_RADIUS_KM,
				source: 'home'
			};
		} else if (me?.city) {
			// City only (no coords) — still useful for DB/web search by name.
			place = {
				label: [me.city, me.country].filter(Boolean).join(', '),
				city: me.city,
				region: null,
				country: me.country ?? null,
				lat: NaN,
				lng: NaN,
				radiusKm: NEAR_RADIUS_KM,
				source: 'home'
			};
		}
	}

	const gender = (locals.user as { gender?: string | null }).gender ?? null;
	const log: string[] = [];
	const foundRaces = new Map<string, RaceRef>();
	let openRaceId: string | null = null;

	try {
		const result = await generateText({
			model: getModel(),
			system: buildSystem(gender, locals.user.name, place),
			messages,
			stopWhen: stepCountIs(10),
			tools: {
				search_races: tool({
					description:
						'Search OUR race database. Provide any combination of distance range, time window, city and category. Returns matching upcoming races.',
					inputSchema: z.object({
						distanceMinKm: z.number().nullable().optional().describe('Min distance km, e.g. 9 for a 10k.'),
						distanceMaxKm: z.number().nullable().optional().describe('Max distance km, e.g. 11 for a 10k.'),
						withinDays: z.number().nullable().optional().describe('Only races within this many days from today.'),
						city: z.string().nullable().optional().describe('Filter by host city.'),
						category: z.enum(['local', 'norway', 'international']).nullable().optional(),
						text: z.string().nullable().optional().describe('Free-text match on race name or city.')
					}),
					execute: async (args) => {
						log.push(`🔎 search_races ${JSON.stringify(args)}`);
						const races = await searchRaces(args);
						for (const r of races) foundRaces.set(r.id, r);
						return {
							count: races.length,
							races: races.map((r) => ({
								name: r.name,
								city: r.city,
								country: r.country,
								category: r.category,
								distanceKm: r.distanceKm,
								date: r.date
							}))
						};
					}
				}),
				web_discover_races: tool({
					description:
						'Freely search the WEB for running races in ANY place or area the user names (city, region, country, island, etc.) — e.g. "Crete in August" or "around Lalleröd in late July". You do NOT need a specific race name. Returns candidate races with links; follow up with find_and_add_race for the best ones.',
					inputSchema: z.object({
						locationName: z
							.string()
							.describe('Place or area to search, e.g. "Crete, Greece", "Lalleröd, Sweden", "Scotland".'),
						timeframe: z
							.string()
							.nullable()
							.optional()
							.describe('When, in the user\'s words, e.g. "late July 2026", "August", "this autumn".'),
						radiusKm: z
							.number()
							.nullable()
							.optional()
							.describe('Optional radius in km when the location is a point/town (e.g. 40 for "30 min drive").'),
						distanceMinKm: z.number().nullable().optional(),
						distanceMaxKm: z.number().nullable().optional()
					}),
					execute: async (args) => {
						log.push(`🌍 web_discover_races ${JSON.stringify(args)}`);
						const year = new Date().getFullYear();
						const distHint =
							args.distanceMinKm != null || args.distanceMaxKm != null
								? `${args.distanceMinKm ?? ''}-${args.distanceMaxKm ?? ''}km `
								: '';
						const radiusHint = args.radiusKm ? ` within ${args.radiusKm}km of` : ' in';
						const when = args.timeframe?.trim() || `${year} ${year + 1}`;
						const q = `${distHint}running races${radiusHint} ${args.locationName} ${when} registration`;
						const results = await tavilySearch(q);
						if (results.length === 0)
							return { results: [], note: 'No web results. Try a broader location or timeframe.' };
						return {
							location: args.locationName,
							timeframe: args.timeframe ?? null,
							results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }))
						};
					}
				}),
				find_and_add_race: tool({
					description:
						'Research ONE specific race and add it to our database — either a race the user named, or a candidate you found via web_discover_races. After adding, tell the user it has been added and point them to the link below your message.',
					inputSchema: z.object({
						name: z.string().describe('The race name, possibly with city/year, e.g. "Tromsø Midnight Sun Marathon".')
					}),
					execute: async ({ name }) => {
						log.push(`➕ find_and_add_race "${name}"`);
						const { imported, notFoundReason } = await researchAndImportRace(
							name,
							(m) => log.push(m),
							'coach'
						);
						if (!imported) {
							return { ok: false, reason: notFoundReason ?? 'Could not find that race.' };
						}
						if (imported.primaryDistanceId) {
							openRaceId = imported.primaryDistanceId;
							foundRaces.set(imported.primaryDistanceId, {
								id: imported.primaryDistanceId,
								name: imported.name,
								city: imported.city,
								country: null,
								category: 'norway',
								distanceKm: null,
								date: null
							});
						}
						return {
							ok: true,
							isNew: imported.isNew,
							name: imported.name,
							city: imported.city,
							opened: !!imported.primaryDistanceId
						};
					}
				})
			}
		});

		return json({
			reply: result.text || "Let's go! What are we chasing?",
			races: [...foundRaces.values()],
			openRaceId,
			log
		});
	} catch (err) {
		log.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
		return json(
			{ reply: 'Oof, I pulled a hamstring there. Try me again in a sec! 💥', races: [], openRaceId: null, log },
			{ status: 500 }
		);
	}
};
