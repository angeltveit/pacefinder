/**
 * Results scraper: finds and parses race results/leaderboards for completed races.
 * Common Norwegian timing providers: EQ Timing, FriRes/Brighter Timing, CCS Live.
 * International: Results.world, MYLAPS, Racetimer, etc.
 *
 * Strategy:
 * 1. If resultsUrl is already known, scrape it directly
 * 2. Otherwise, visit the race website and look for "Resultater"/"Results" links
 * 3. Fall back to searching "[race name] results [year]"
 * 4. Parse the HTML table into structured results
 */
import { generateObject, generateText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, raceResults } from '$lib/server/db/schema';
import { eq, and, isNull, lte, sql } from 'drizzle-orm';

function getModel() {
	const provider = env.LLM_PROVIDER ?? 'openai';
	const model = env.LLM_MODEL ?? 'gpt-4o-mini';
	const apiKey = env.LLM_API_KEY;

	if (provider === 'anthropic') {
		return createAnthropic({ apiKey })(model);
	}
	return createOpenAI({ apiKey, baseURL: env.LLM_BASE_URL })(model);
}

// ── Page fetching ────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)',
				Accept: 'text/html,application/xhtml+xml'
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}

function extractLinksAndTables(html: string, baseUrl: string) {
	const $ = cheerio.load(html);

	// Find results-related links
	const resultLinks: { text: string; href: string }[] = [];
	$('a[href]').each((_, el) => {
		const text = $(el).text().trim().toLowerCase();
		const href = $(el).attr('href') ?? '';
		if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

		// Match results-related links
		if (/resultat|results?|tidtaking|timing|live.?result/i.test(text + href)) {
			let resolved: string;
			try {
				resolved = href.startsWith('http') ? href : new URL(href, baseUrl).href;
			} catch {
				return;
			}
			resultLinks.push({ text: $(el).text().trim(), href: resolved });
		}
	});

	// Extract tables (for results pages)
	const tables: string[] = [];
	$('table').each((_, table) => {
		const rows: string[][] = [];
		$(table).find('tr').each((_, tr) => {
			const cells: string[] = [];
			$(tr).find('th, td').each((_, cell) => {
				cells.push($(cell).text().trim());
			});
			if (cells.length > 0) rows.push(cells);
		});
		if (rows.length >= 3 && rows[0].length >= 2) {
			// Format as readable text table
			tables.push(rows.map(r => r.join(' | ')).join('\n'));
		}
	});

	// Also check for div-based result grids (common in modern timing systems)
	const gridText = $('[class*="result"], [class*="runner"], [class*="athlete"], [id*="result"]')
		.text().replace(/\s+/g, ' ').trim().slice(0, 3000);

	const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);

	return { resultLinks: resultLinks.slice(0, 10), tables: tables.slice(0, 3), gridText, pageText };
}

// ── EQ Timing event search ───────────────────────────────────────────────────

let eqTimingEventsCache: { id: number; name: string; starttime: string }[] | null = null;
let eqTimingCacheTime = 0;

/**
 * Search EQ Timing's API for a specific race by name.
 * The API returns ALL events (~43k); we cache the list for 1 hour.
 */
export async function findEqTimingEvent(
	raceName: string,
	raceDate: Date | null,
	onLog: (msg: string) => void
): Promise<string | null> {
	// Cache the event list for 1 hour
	if (!eqTimingEventsCache || Date.now() - eqTimingCacheTime > 3600_000) {
		onLog(`    EQ Timing: fetching event catalog…`);
		try {
			const res = await fetch('https://live.eqtiming.com/api/events', {
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
				signal: AbortSignal.timeout(30_000)
			});
			if (!res.ok) return null;
			const data = await res.json() as { Id: number; Name: string; Starttime: string }[];
			eqTimingEventsCache = data.map(e => ({ id: e.Id, name: e.Name, starttime: e.Starttime }));
			eqTimingCacheTime = Date.now();
			onLog(`    EQ Timing: cached ${eqTimingEventsCache.length} events`);
		} catch {
			return null;
		}
	}

	// Normalize race name for matching
	const normalize = (s: string) => s.toLowerCase()
		.replace(/\b20\d{2}\b/g, '') // strip years only (2000-2099), NOT event ID prefixes like "4625"
		.replace(/[–—-]\s*(5k|10k|half|halvmarathon|marathon|[\d.]+\s*km).*$/i, '') // strip distance suffix
		.replace(/[^a-zæøå0-9]/gi, '') // only letters/numbers
		.trim();

	const target = normalize(raceName);
	const year = raceDate ? raceDate.getFullYear() : new Date().getFullYear();

	// Find matches: name contains our target AND year matches
	const matches = eqTimingEventsCache!.filter(e => {
		const eName = normalize(e.name);
		const eYear = e.starttime ? new Date(e.starttime).getFullYear() : 0;
		return eYear === year && (eName.includes(target) || target.includes(eName));
	});

	if (matches.length === 0) {
		// Try fuzzy: any event containing the first significant word of the race name
		const words = raceName.toLowerCase().replace(/\b20\d{2}\b/, '').trim().split(/\s+/)
			.filter(w => w.length > 4 && !/rundt|løpet|lopet|løp|löp|run|race|marathon|half/i.test(w));
		if (words.length > 0) {
			const keyword = words[0];
			const fuzzy = eqTimingEventsCache!.filter(e => {
				const eYear = e.starttime ? new Date(e.starttime).getFullYear() : 0;
				return eYear === year && e.name.toLowerCase().includes(keyword);
			});
			if (fuzzy.length === 1) {
				onLog(`    EQ Timing: fuzzy match → ${fuzzy[0].name} (ID ${fuzzy[0].id})`);
				return `https://live.eqtiming.com/${fuzzy[0].id}`;
			} else if (fuzzy.length > 1) {
				onLog(`    EQ Timing: ${fuzzy.length} fuzzy matches for "${keyword}": ${fuzzy.map(f => f.name).join(', ')}`);
				// Pick the closest by date if we have a date
				if (raceDate) {
					const closest = fuzzy.sort((a, b) =>
						Math.abs(new Date(a.starttime).getTime() - raceDate.getTime()) -
						Math.abs(new Date(b.starttime).getTime() - raceDate.getTime())
					)[0];
					onLog(`    EQ Timing: picking closest by date → ${closest.name} (ID ${closest.id})`);
					return `https://live.eqtiming.com/${closest.id}`;
				}
			}
		}
		return null;
	}

	// Exact or near-exact match
	const best = matches[0];
	onLog(`    EQ Timing: found "${best.name}" (ID ${best.id})`);
	return `https://live.eqtiming.com/${best.id}`;
}

// ── Distance helpers ─────────────────────────────────────────────────────────

/**
 * Returns true for URLs that are aggregate/schedule pages rather than
 * results for a specific race (e.g. the NFIF org calendar on EQ Timing).
 */
function isGenericScheduleUrl(url: string): boolean {
	// EQ Timing org-level calendar — has organizationId= but no specific /event/ path
	if (/live\.eqtiming\.com[/?#]/i.test(url) && /organizationId=/i.test(url) && !/\/event\//i.test(url)) return true;
	return false;
}

// ── Search all timing providers ──────────────────────────────────────────────

/**
 * Deterministically searches all known timing providers for a race.
 * Returns the first valid results URL found, or null.
 */
export async function searchAllTimingProviders(
	raceName: string,
	raceDate: Date | null,
	onLog: (msg: string) => void
): Promise<string | null> {
	// 1. EQ Timing catalog search (most Norwegian races)
	const eqUrl = await findEqTimingEvent(raceName, raceDate, onLog);
	if (eqUrl) return eqUrl;

	// 2. Tavily search targeting known timing provider domains
	if (!env.TAVILY_API_KEY) return null;
	const year = raceDate ? raceDate.getFullYear() : new Date().getFullYear();
	const query = `"${raceName.replace(/\s*(5K|10K|\d+\s*km)$/i, '')}" ${year} site:live.eqtiming.com OR site:live.ultimate.dk OR site:results.brighter.io OR site:racetimer.se OR site:live.ccs.no`;
	onLog(`    Tavily timing search: "${query.slice(0, 80)}…"`);

	try {
		const res = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				query,
				search_depth: 'basic',
				max_results: 5
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return null;
		const data = await res.json() as { results?: { url: string; title: string }[] };
		const results = (data.results ?? []).filter(r =>
			/eqtiming|ultimate\.dk|brighter|racetimer|ccs\.no/i.test(r.url) &&
			!isGenericScheduleUrl(r.url)
		);
		if (results.length > 0) {
			onLog(`    Tavily: found ${results[0].title} → ${results[0].url}`);
			return results[0].url;
		}
	} catch { /* ignore */ }

	return null;
}

function distanceLabel(km: number | null): string {
	if (!km) return 'Unknown';
	if (km >= 42 && km <= 43) return 'Marathon (42.195 km)';
	if (km >= 21 && km <= 22) return 'Half Marathon (21.1 km)';
	if (km >= 9.5 && km <= 10.5) return '10K';
	if (km >= 4.5 && km <= 5.5) return '5K';
	if (km >= 3 && km <= 4) return '3K';
	return `${km} km`;
}

/** Expected finish time range in seconds for top-20 results */
function expectedTimeRange(km: number | null): { min: number; max: number } {
	if (!km) return { min: 0, max: 86400 };
	if (km >= 42) return { min: 7200, max: 36000 };    // 2h – 10h
	if (km >= 20) return { min: 3300, max: 18000 };    // 55min – 5h
	if (km >= 9) return { min: 1500, max: 9000 };      // 25min – 2.5h
	if (km >= 4) return { min: 600, max: 5400 };       // 10min – 1.5h
	return { min: 300, max: 3600 };                     // 5min – 1h
}

// ── Ultimate.dk specific handler ─────────────────────────────────────────────

/**
 * For Ultimate.dk pages (live.ultimate.dk), we can call data.php directly
 * with a specific distance parameter, bypassing the JS-rendered leaderboard.
 */
async function fetchUltimateDkResults(
	html: string,
	eventUrl: string,
	distanceKm: number | null,
	onLog: (msg: string) => void
): Promise<string[] | null> {
	const eventMatch = eventUrl.match(/eventid=(\d+)/i);
	if (!eventMatch) return null;
	const eventId = eventMatch[1];

	// Parse distance options from the select dropdown
	const $ = cheerio.load(html);
	const distanceOptions: { value: string; label: string }[] = [];
	$('select[onchange*="refreshLeaderBoard"] option').each((_, el) => {
		const val = $(el).attr('value');
		const text = $(el).text().trim();
		// Only collect numeric values (the distance selector, not category/limit)
		if (val && /^\d+$/.test(val)) {
			distanceOptions.push({ value: val, label: text });
		}
	});

	if (distanceOptions.length === 0) return null;

	// Match by distance label
	const label = distanceLabel(distanceKm).toLowerCase();
	const km = distanceKm ?? 0;
	let match = distanceOptions.find(o => {
		const l = o.label.toLowerCase();
		if (km >= 42 && km <= 43) return /marathon/.test(l) && !/half|halv/.test(l);
		if (km >= 21 && km <= 22) return /half|halv/.test(l);
		if (km >= 9 && km <= 11) return /10\s*km|10k/.test(l);
		if (km >= 4 && km <= 6) return /5\s*km|5k/.test(l);
		// Fallback: pick closest by parsing km from label
		return false;
	});

	// Fallback: pick first option if no match and only one option
	if (!match && distanceOptions.length === 1) match = distanceOptions[0];

	if (!match) {
		onLog(`    Ultimate.dk: no matching distance for ${distanceLabel(distanceKm)} among: ${distanceOptions.map(o => o.label).join(', ')}`);
		return null;
	}

	onLog(`    Ultimate.dk: fetching distance "${match.label}" (value=${match.value}) via data.php`);
	const apiUrl = `https://live.ultimate.dk/desktop/front/data.php?eventid=${eventId}&mode=results&distance=${match.value}&category=0&records=0&start=0&limit=25&language=en`;
	const apiResponse = await fetchPage(apiUrl);
	if (!apiResponse) return null;

	// The response is JS that sets innerHTML — extract the HTML table from list_results div
	const htmlMatch = apiResponse.match(/getElementById\('list_results'\)\.innerHTML='([\s\S]+?)';/);
	if (!htmlMatch) {
		// Try alternate: innerHTML assigned with semicolon or end
		const fallback = apiResponse.match(/innerHTML='(<table[\s\S]+?<\/table>)'/);
		if (!fallback) return null;
		const parsed2 = extractLinksAndTables(fallback[1].replace(/\\'/g, "'"), apiUrl);
		return parsed2.tables.length > 0 ? parsed2.tables : null;
	}

	const tableHtml = htmlMatch[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
	const parsed = extractLinksAndTables(tableHtml, apiUrl);
	return parsed.tables.length > 0 ? parsed.tables : null;
}

// ── EQ Timing results handler ────────────────────────────────────────────────

/**
 * Fetches results directly from EQ Timing's JSON API.
 * EQ Timing pages render via JS so we must use their API.
 */
async function fetchEqTimingResults(
	eventId: string,
	distanceKm: number | null,
	onLog: (msg: string) => void
): Promise<{ position: number; name: string; bibNumber: string; finishTime: string; category: string; categoryPosition: number | null; club: string }[] | null> {
	// 1. Get event structure to find the race (Etappe) UID
	const eventRes = await fetch(`https://live.eqtiming.com/api/event/${eventId}`, {
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
		signal: AbortSignal.timeout(10_000)
	}).catch(() => null);
	if (!eventRes?.ok) return null;

	const eventData = await eventRes.json() as {
		Etapper?: Record<string, { UID: number; Navn: string; Distanse?: number }>;
	};
	const etapper = eventData.Etapper;
	if (!etapper || Object.keys(etapper).length === 0) return null;

	// 2. Pick the right Etappe (race) — match by distance or pick first
	const etappeList = Object.values(etapper);
	let chosen = etappeList[0];
	if (distanceKm && etappeList.length > 1) {
		// Try matching by name (e.g. "10 km Tveitevannet Rundt")
		const kmStr = Math.round(distanceKm).toString();
		const byName = etappeList.find(e => e.Navn.includes(`${kmStr} km`) || e.Navn.includes(`${kmStr}km`));
		if (byName) chosen = byName;
	}
	onLog(`    EQ Timing API: fetching results for "${chosen.Navn}" (UID ${chosen.UID})`);

	// 3. Fetch total results (all genders combined)
	const resultsRes = await fetch(
		`https://live.eqtiming.com/api/Result/Total/${eventId}/${chosen.UID}?count=500`,
		{
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
			signal: AbortSignal.timeout(15_000)
		}
	).catch(() => null);
	if (!resultsRes?.ok) return null;

	const resultsData = await resultsRes.json() as {
		Items?: Array<{
			Plassering?: { Total: number; Klasse: number };
			Formatert?: string;
			StatusTekst?: string;
			Deltaker?: {
				Startnummer?: number;
				FullStartnummer?: number | string;
				Klubbnavn?: string;
				Utover?: { NavnFormatert?: string; Fornavn?: string; Etternavn?: string };
				Klasse?: { Navn?: string };
			};
		}>;
		TotalItems?: number;
	};

	const items = resultsData.Items;
	if (!items || items.length === 0) {
		onLog(`    EQ Timing API: no results yet (0 items)`);
		return null;
	}

	onLog(`    EQ Timing API: got ${items.length} results (total: ${resultsData.TotalItems})`);

	// 4. Map to standard result format (top 20)
	const results: { position: number; name: string; bibNumber: string; finishTime: string; category: string; categoryPosition: number | null; club: string }[] = [];
	for (const item of items.slice(0, 20)) {
		const d = item.Deltaker;
		if (!d) continue;
		const time = item.Formatert;
		if (!time || item.StatusTekst !== 'TIME') continue; // skip DNS/DNF/etc

		const name = d.Utover?.NavnFormatert ?? [d.Utover?.Fornavn, d.Utover?.Etternavn].filter(Boolean).join(' ');
		results.push({
			position: item.Plassering?.Total ?? results.length + 1,
			name: name || 'Unknown',
			bibNumber: String(d.FullStartnummer ?? d.Startnummer ?? ''),
			finishTime: time,
			category: d.Klasse?.Navn ?? '',
			categoryPosition: item.Plassering?.Klasse ?? null,
			club: d.Klubbnavn ?? ''
		});
	}

	return results.length > 0 ? results : null;
}

async function searchForResults(query: string): Promise<{ url: string; title: string }[]> {
	if (!env.TAVILY_API_KEY) return [];
	try {
		const res = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				query,
				search_depth: 'basic',
				max_results: 5
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return [];
		const data = await res.json() as { results?: { url: string; title: string }[] };
		return (data.results ?? []).filter(r =>
			/resultat|result|timing|eqtiming|frires|live/i.test(r.url + r.title)
		);
	} catch {
		return [];
	}
}

// ── Time parsing ─────────────────────────────────────────────────────────────

function parseTimeToSeconds(time: string): number | null {
	// Formats: "1:23:45", "01:23:45", "23:45", "1:23:45.6"
	const parts = time.replace(',', '.').split(':');
	if (parts.length === 3) {
		const [h, m, s] = parts.map(Number);
		if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s;
	}
	if (parts.length === 2) {
		const [m, s] = parts.map(Number);
		if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
	}
	return null;
}

// ── Result extraction schema ─────────────────────────────────────────────────

const resultSchema = z.object({
	results: z.array(z.object({
		position: z.number().nullable().describe('Overall finishing position'),
		name: z.string().describe('Runner name'),
		bibNumber: z.string().nullable().describe('Bib/start number'),
		finishTime: z.string().describe('Finish time as displayed (e.g. "1:23:45")'),
		category: z.string().nullable().describe('Age/gender category (e.g. "M 30-39", "K Senior")'),
		categoryPosition: z.number().nullable().describe('Position within category'),
		club: z.string().nullable().describe('Club/team name')
	})).describe('Top 20 finishers from the results table')
});

const RESULTS_SYSTEM = `You are extracting race results from a timing company webpage.
The page contains a table or grid of race results. Extract the TOP 20 finishers.

Common formats:
- EQ Timing: columns like "Plass", "Startnr", "Navn", "Klubb", "Klasse", "Tid"
- FriRes: "Place", "Bib", "Name", "Club", "Cat", "Time"
- International: "Position", "Bib", "Athlete", "Team", "Category", "Chip Time"

Rules:
- Extract OVERALL results (not per-category). If the table is already filtered by category, note the category.
- "Tid", "Time", "Chip Time", "Nettotid", "Net Time" = finish time
- "Plass", "Place", "Pos", "#" = position
- "Startnr", "Bib", "Nr" = bib number
- "Klubb", "Club", "Team" = club
- "Klasse", "Cat", "Category", "Kat" = category
- Return at most 20 results, sorted by position
- If position is not explicit, infer from row order (1, 2, 3...)
- Skip header rows, DNS/DNF entries`;

// ── Main export: find and scrape results for completed races ─────────────────

// Shape expected by findAndParseResults (flattened from 3 tables)
interface RaceForResults {
	id: string;
	name: string;
	distanceKm: number | null;
	raceDate: Date | null;
	resultsUrl: string | null;
	websiteUrl: string | null;
}

export async function scrapeRaceResults(
	onLog: (msg: string) => void
): Promise<{ scraped: number; failed: number }> {
	// Find distances whose edition date is in the past and have no results yet
	const pastRaces = await db
		.select({
			id: raceDistances.id,
			name: raceDistances.name,
			distanceKm: raceDistances.distanceKm,
			raceDate: raceEditions.raceDate,
			resultsUrl: raceDistances.resultsUrl,
			websiteUrl: sql<string | null>`coalesce(${raceEditions.websiteUrl}, ${raceSeries.websiteUrl})`
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(
			and(
				lte(raceEditions.raceDate, new Date()),
				sql`NOT EXISTS (SELECT 1 FROM race_results WHERE distance_id = ${raceDistances.id} LIMIT 1)`
			)
		)
		.limit(5);

	if (pastRaces.length === 0) {
		onLog('No completed races without results found');
		return { scraped: 0, failed: 0 };
	}

	onLog(`📊 Found ${pastRaces.length} completed races to check for results`);
	let scraped = 0;
	let failed = 0;

	for (const race of pastRaces) {
		onLog(`  [${scraped + failed + 1}/${pastRaces.length}] ${race.name}`);

		// Rate limit: 5s between races
		if (scraped + failed > 0) await new Promise(r => setTimeout(r, 5000));

		try {
			const results = await findAndParseResults(race, onLog);
			if (results && results.length > 0) {
				// Insert results
				await db.insert(raceResults).values(
					results.map(r => ({
						distanceId: race.id,
						position: r.position,
						name: r.name,
						bibNumber: r.bibNumber,
						finishTime: r.finishTime,
						finishTimeSeconds: parseTimeToSeconds(r.finishTime),
						category: r.category,
						categoryPosition: r.categoryPosition,
						club: r.club
					}))
				);
				onLog(`    ✓ Saved ${results.length} results`);
				scraped++;
			} else {
				onLog(`    ✗ No results found (might not be published yet)`);
				failed++;
			}
		} catch (err) {
			onLog(`    ⚠️ Error: ${err instanceof Error ? err.message : String(err)}`);
			failed++;
		}
	}

	return { scraped, failed };
}

// ── Find results URL and parse for a single race ────────────────────────────

async function findAndParseResults(
	race: RaceForResults,
	onLog: (msg: string) => void
): Promise<z.infer<typeof resultSchema>['results'] | null> {
	let resultsUrl = race.resultsUrl;
	let html: string | null = null;

	// Step 1: If we already have a results URL, try it directly
	if (resultsUrl) {
		onLog(`    Trying known results URL…`);
		html = await fetchPage(resultsUrl);
	}

	// Step 2: Check the race's official website for results links
	let candidateLinks: { text: string; href: string }[] = [];
	if (!html && race.websiteUrl) {
		onLog(`    Checking official website for results link…`);
		const siteHtml = await fetchPage(race.websiteUrl);
		if (siteHtml) {
			const { resultLinks } = extractLinksAndTables(siteHtml, race.websiteUrl);
			candidateLinks = resultLinks;
			// Filter out generic schedule/calendar pages
			const specificLinks = resultLinks.filter(l => !isGenericScheduleUrl(l.href));
			if (specificLinks.length > 0) {
				onLog(`    Found ${specificLinks.length} results links: ${specificLinks.map(l => l.text).join(', ')}`);
				// Prioritize links pointing to known timing providers
				const timingLink = specificLinks.find(l => /eqtiming|frires|ultimate\.dk|ccs|racetimer|mylaps/i.test(l.href));
				const firstLink = timingLink ?? specificLinks[0];
				resultsUrl = firstLink.href;
				html = await fetchPage(resultsUrl);
			}
		}
	}

	// Step 3: Search all known timing providers (EQ Timing catalog + Tavily)
	if (!html) {
		const providerUrl = await searchAllTimingProviders(race.name, race.raceDate, onLog);
		if (providerUrl) {
			resultsUrl = providerUrl;
			html = await fetchPage(resultsUrl);
		}
	}

	// Step 4: Generic search for results via Tavily
	if (!html) {
		const year = race.raceDate ? new Date(race.raceDate).getFullYear() : new Date().getFullYear();
		const query = `${race.name} resultater ${year} eqtiming OR frires OR results`;
		onLog(`    Searching: "${query}"`);
		const searchResults = await searchForResults(query);
		if (searchResults.length > 0) {
			onLog(`    Found: ${searchResults[0].title} → ${searchResults[0].url}`);
			resultsUrl = searchResults[0].url;
			html = await fetchPage(resultsUrl);
		}
	}

	if (!html) return null;

	// Save the results URL for future reference (never save generic schedule pages)
	if (resultsUrl && resultsUrl !== race.resultsUrl && !isGenericScheduleUrl(resultsUrl)) {
		await db.update(raceDistances).set({ resultsUrl }).where(eq(raceDistances.id, race.id));
	}

	// Step 4: Parse the results page
	const { tables, gridText, pageText } = extractLinksAndTables(html, resultsUrl!);

	// EQ Timing: use their JSON API directly (pages render via JS, no static HTML tables)
	const eqMatch = resultsUrl!.match(/live\.eqtiming\.com\/(\d+)/i);
	if (eqMatch) {
		onLog(`    Detected EQ Timing — using JSON API`);
		const eqResults = await fetchEqTimingResults(eqMatch[1], race.distanceKm, onLog);
		if (eqResults) return eqResults;
		// Fall through to generic parsing
	}

	// Ultimate.dk: use the data.php API to get distance-specific results
	if (/live\.ultimate\.dk/i.test(resultsUrl!)) {
		onLog(`    Detected Ultimate.dk — using distance-specific API`);
		const ultimateTables = await fetchUltimateDkResults(html, resultsUrl!, race.distanceKm, onLog);
		if (ultimateTables) {
			return await parseWithLLM(ultimateTables, '', race.distanceKm, onLog);
		}
		// Fall through to generic parsing if API approach fails
	}

	if (tables.length === 0 && !gridText) {
		// Might be an EQ Timing page that loads data dynamically — check for iframe or API
		const $ = cheerio.load(html);
		const iframe = $('iframe[src*="result"], iframe[src*="timing"], iframe[src*="ultimate"]').attr('src');
		if (iframe) {
			onLog(`    Found results iframe, following…`);
			let iframeUrl: string;
			try {
				iframeUrl = iframe.startsWith('http') ? iframe : new URL(iframe, resultsUrl!).href;
			} catch {
				return null;
			}
			const iframeHtml = await fetchPage(iframeUrl);
			if (iframeHtml) {
				const parsed = extractLinksAndTables(iframeHtml, iframeUrl);
				if (parsed.tables.length > 0) {
					return await parseWithLLM(parsed.tables, parsed.pageText, race.distanceKm, onLog);
				}
			}
		}

		// Try other candidate links from step 2 (results page may have been an index)
		const { resultLinks: subLinks } = extractLinksAndTables(html, resultsUrl!);
		const allLinks = [...subLinks, ...candidateLinks].filter(l => l.href !== resultsUrl);
		for (const link of allLinks.slice(0, 3)) {
			if (/eqtiming|frires|ultimate\.dk|ccs|racetimer|mylaps|live\./i.test(link.href)) {
				onLog(`    Trying sub-link: ${link.text} → ${link.href}`);
				const subHtml = await fetchPage(link.href);
				if (subHtml) {
					const sub = extractLinksAndTables(subHtml, link.href);
					if (sub.tables.length > 0) {
						resultsUrl = link.href;
						return await parseWithLLM(sub.tables, sub.pageText, race.distanceKm, onLog);
					}
				}
			}
		}

		// If the page text contains timing data, try to parse it anyway
		if (/\d{1,2}:\d{2}:\d{2}/.test(pageText)) {
			return await parseWithLLM([], pageText, race.distanceKm, onLog);
		}
		return null;
	}

	return await parseWithLLM(tables, pageText, race.distanceKm, onLog);
}

// ── LLM parsing of results table ─────────────────────────────────────────────

async function parseWithLLM(
	tables: string[],
	pageText: string,
	distanceKm: number | null,
	onLog: (msg: string) => void
): Promise<z.infer<typeof resultSchema>['results'] | null> {
	const tableContent = tables.length > 0
		? `TABLES:\n${tables.join('\n\n---TABLE BREAK---\n\n')}`
		: `PAGE TEXT:\n${pageText.slice(0, 3000)}`;

	const dlabel = distanceLabel(distanceKm);
	const timeRange = expectedTimeRange(distanceKm);
	const minHMS = new Date(timeRange.min * 1000).toISOString().slice(11, 19);
	const maxHMS = new Date(timeRange.max * 1000).toISOString().slice(11, 19);

	const distanceContext = distanceKm
		? `\n\nTARGET RACE: ${dlabel}. Expected finish times: ${minHMS} – ${maxHMS}.\nIf this page contains results for MULTIPLE distances (e.g. Marathon AND Half Marathon), ONLY extract results for the ${dlabel}. Discard rows where the finish time is outside the expected range.`
		: '';

	onLog(`    Asking LLM to extract ${dlabel} results…`);

	try {
		const { object } = await generateObject({
			model: getModel(),
			mode: 'json',
			system: RESULTS_SYSTEM + distanceContext,
			prompt: tableContent,
			schema: resultSchema,
			schemaName: 'RaceResults',
			schemaDescription: 'Extracted race results with runner names and times'
		});

		if (object.results.length === 0) return null;

		// Post-filter: discard results with finish times clearly outside expected range
		const filtered = object.results.filter(r => {
			const secs = parseTimeToSeconds(r.finishTime);
			if (secs === null) return true; // keep if we can't parse
			return secs >= timeRange.min && secs <= timeRange.max;
		});

		return filtered.length > 0 ? filtered : null;
	} catch (err) {
		onLog(`    ⚠️ LLM parse failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

// ── Bib-specific lookup (for "Your Result" feature) ──────────────────────────

/**
 * Looks up a single participant by bib number.
 * Checks DB first; if not found, queries the timing provider directly.
 */
export async function lookupBibResult(
	distanceId: string,
	bib: string
): Promise<{
	position: number | null;
	name: string;
	bibNumber: string | null;
	finishTime: string;
	category: string | null;
	categoryPosition: number | null;
	club: string | null;
	distance: string | null;
}[]> {
	const normalizedBib = bib.trim();
	if (!normalizedBib) return [];

	// 1. Check DB first
	const existing = await db
		.select()
		.from(raceResults)
		.where(and(eq(raceResults.distanceId, distanceId), eq(raceResults.bibNumber, normalizedBib)))
		.limit(1);

	if (existing.length > 0) {
		const r = existing[0];
		return [{
			position: r.position,
			name: r.name,
			bibNumber: r.bibNumber,
			finishTime: r.finishTime ?? '',
			category: r.category,
			categoryPosition: r.categoryPosition,
			club: r.club,
			distance: null
		}];
	}

	// 2. Try timing provider
	const dist = await db.query.raceDistances.findFirst({ where: eq(raceDistances.id, distanceId) });
	if (!dist?.resultsUrl) return [];
	const race = { resultsUrl: dist.resultsUrl, distanceKm: dist.distanceKm };

	if (/live\.ultimate\.dk/i.test(race.resultsUrl)) {
		const result = await fetchUltimateDkBibSearch(race.resultsUrl, normalizedBib);
		return result ? [{ ...result, distance: null }] : [];
	}

	// EQ Timing: search all Etapper for matching bib
	const eqMatch = race.resultsUrl.match(/live\.eqtiming\.com\/(\d+)/i);
	if (eqMatch) {
		return fetchEqTimingBibSearch(eqMatch[1], normalizedBib);
	}

	return [];
}

/**
 * Searches Ultimate.dk for a specific bib number via the search API.
 */
async function fetchUltimateDkBibSearch(
	eventUrl: string,
	bib: string
): Promise<{
	position: number | null;
	name: string;
	bibNumber: string | null;
	finishTime: string;
	category: string | null;
	categoryPosition: number | null;
	club: string | null;
} | null> {
	const eventMatch = eventUrl.match(/eventid=(\d+)/i);
	if (!eventMatch) return null;
	const eventId = eventMatch[1];

	const searchUrl = `https://live.ultimate.dk/desktop/front/data.php?eventid=${eventId}&mode=search&search_bib=${encodeURIComponent(bib)}&language=en&searchmode=1`;
	const response = await fetchPage(searchUrl);
	if (!response) return null;

	// Response is JS that sets innerHTML — extract the table HTML
	const htmlMatch = response.match(/getElementById\('search_results'\)\.innerHTML='([\s\S]+?)';/);
	if (!htmlMatch) return null;

	const html = htmlMatch[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
	const $ = cheerio.load(html);

	// Table columns: Race No | Name | Nation | Club | Distance | Category | Time | #Sex | #Cat
	const rows: string[][] = [];
	$('table tr').each((_, tr) => {
		const cells: string[] = [];
		$(tr).find('td').each((_, td) => {
			cells.push($(td).text().trim());
		});
		if (cells.length >= 7 && cells[6] && cells[6] !== 'Time') rows.push(cells);
	});

	if (rows.length === 0) return null;

	// Find the exact bib match (should be rows[0])
	const row = rows.find(r => r[0]?.trim() === bib) ?? rows[0];

	return {
		position: null, // search results don't include overall position
		name: row[1] ?? '',
		bibNumber: row[0]?.trim() ?? null,
		finishTime: row[6] ?? '',
		category: row[5] ?? null,
		categoryPosition: parseInt(row[8] ?? '') || null,
		club: row[3] ?? null
	};
}

// ── Single race results fetch (for admin "fetch results" button) ─────────────

export async function fetchResultsForRace(
	distanceId: string,
	onLog: (msg: string) => void
): Promise<boolean> {
	const row = await db
		.select({
			id: raceDistances.id,
			name: raceDistances.name,
			distanceKm: raceDistances.distanceKm,
			raceDate: raceEditions.raceDate,
			resultsUrl: raceDistances.resultsUrl,
			websiteUrl: sql<string | null>`coalesce(${raceEditions.websiteUrl}, ${raceSeries.websiteUrl})`
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceDistances.id, distanceId))
		.limit(1);
	if (row.length === 0) return false;
	const race = row[0];

	// Clear existing results
	await db.delete(raceResults).where(eq(raceResults.distanceId, distanceId));

	const results = await findAndParseResults(race, onLog);
	if (results && results.length > 0) {
		await db.insert(raceResults).values(
			results.map(r => ({
				distanceId: race.id,
				position: r.position,
				name: r.name,
				bibNumber: r.bibNumber,
				finishTime: r.finishTime,
				finishTimeSeconds: parseTimeToSeconds(r.finishTime),
				category: r.category,
				categoryPosition: r.categoryPosition,
				club: r.club
			}))
		);
		onLog(`✓ Saved ${results.length} results for ${race.name}`);
		return true;
	}
	return false;
}

/**
 * Searches EQ Timing results for a specific bib number.
 */
async function fetchEqTimingBibSearch(
	eventId: string,
	bib: string
): Promise<{
	position: number | null;
	name: string;
	bibNumber: string | null;
	finishTime: string;
	category: string | null;
	categoryPosition: number | null;
	club: string | null;
	distance: string | null;
}[]> {
	// Get event structure
	const eventRes = await fetch(`https://live.eqtiming.com/api/event/${eventId}`, {
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
		signal: AbortSignal.timeout(10_000)
	}).catch(() => null);
	if (!eventRes?.ok) return [];

	const eventData = await eventRes.json() as {
		Etapper?: Record<string, { UID: number; Navn: string }>;
	};
	const etapper = eventData.Etapper;
	if (!etapper || Object.keys(etapper).length === 0) return [];

	const etappeList = Object.values(etapper);
	const results: {
		position: number | null;
		name: string;
		bibNumber: string | null;
		finishTime: string;
		category: string | null;
		categoryPosition: number | null;
		club: string | null;
		distance: string | null;
	}[] = [];

	// Search ALL Etapper for this bib
	for (const etappe of etappeList) {
		const resultsRes = await fetch(
			`https://live.eqtiming.com/api/Result/Total/${eventId}/${etappe.UID}?count=1000`,
			{
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
				signal: AbortSignal.timeout(15_000)
			}
		).catch(() => null);
		if (!resultsRes?.ok) continue;

		const data = await resultsRes.json() as { Items?: Array<Record<string, unknown>> };
		if (!data.Items) continue;

		const item = data.Items.find((i: Record<string, unknown>) => {
			const d = i.Deltaker as Record<string, unknown> | undefined;
			return d && (String(d.FullStartnummer) === bib || String(d.Startnummer) === bib);
		}) as {
			Plassering?: { Total: number; Klasse: number };
			Formatert?: string;
			StatusTekst?: string;
			Deltaker?: {
				Startnummer?: number;
				FullStartnummer?: number | string;
				Klubbnavn?: string;
				Utover?: { NavnFormatert?: string; Fornavn?: string; Etternavn?: string };
				Klasse?: { Navn?: string };
			};
		} | undefined;

		if (!item?.Deltaker || !item.Formatert) continue;
		const d = item.Deltaker;
		const name = d.Utover?.NavnFormatert ?? [d.Utover?.Fornavn, d.Utover?.Etternavn].filter(Boolean).join(' ');

		results.push({
			position: item.Plassering?.Total ?? null,
			name: name || 'Unknown',
			bibNumber: bib,
			finishTime: item.Formatert,
			category: d.Klasse?.Navn ?? null,
			categoryPosition: item.Plassering?.Klasse ?? null,
			club: d.Klubbnavn ?? null,
			distance: etappe.Navn
		});
	}

	return results;
}
