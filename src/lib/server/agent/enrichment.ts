/**
 * Agentic enrichment: gives Claude tools to browse the web and find
 * official websites, dates, medal info, and cover photos for each race.
 * Claude decides what pages to visit and what links to follow.
 */
import { generateText, tool, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import type { ClassifiedRace, RaceDayInfo } from './types';

interface EnrichmentResult {
	raceDate?: string;
	registrationUrl?: string;
	resultsUrl?: string;
	websiteUrl?: string;
	imageUrl?: string;
	medalStatus?: 'confirmed' | 'likely' | 'unclear';
	distancesKm?: number[];
	registrationDeadline?: string;
	priceMin?: number;
	priceMax?: number;
	priceCurrency?: string;
	fieldSize?: number;
	elevationGainM?: number;
	surface?: 'road' | 'trail' | 'mixed' | 'track';
	raceDayInfo?: RaceDayInfo;
	confidence?: number;
}

// ── LLM setup ────────────────────────────────────────────────────────────────

export function getModel() {
	const provider = env.LLM_PROVIDER ?? 'openai';
	const model = env.LLM_MODEL ?? 'gpt-4o-mini';
	const apiKey = env.LLM_API_KEY;

	if (provider === 'anthropic') {
		return createAnthropic({ apiKey })(model);
	}
	return createOpenAI({ apiKey, baseURL: env.LLM_BASE_URL })(model);
}

// ── Page fetching ────────────────────────────────────────────────────────────

export async function fetchAndParse(url: string) {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0; +https://pacefinder.app)',
				Accept: 'text/html,application/xhtml+xml'
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(12_000)
		});
		if (!res.ok) return null;
		const ct = res.headers.get('content-type') ?? '';
		if (!ct.includes('text/html')) return null;
		const html = await res.text();
		const $ = cheerio.load(html);

		const title = $('title').text().trim();

		// ── Embedded structured data (survives JS-rendered/lazy pages) ──
		// Many race sites that lazy-load still ship the real data inside JSON-LD
		// or framework hydration blobs in the initial HTML. Pull those out.
		const structuredChunks: string[] = [];
		$('script[type="application/ld+json"]').each((_, el) => {
			const raw = $(el).contents().text().trim();
			if (raw) structuredChunks.push(raw);
		});
		for (const id of ['__NEXT_DATA__', '__NUXT_DATA__']) {
			const raw = $(`script#${id}`).contents().text().trim();
			if (raw) structuredChunks.push(raw);
		}
		// Compact + cap embedded JSON so it informs the LLM without blowing context
		const structuredData = structuredChunks
			.map((c) => c.replace(/\s+/g, ' '))
			.join('\n')
			.slice(0, 4000) || null;

		// Extract nav/menu links BEFORE removing nav (important for medal detection)
		const navLinks: { text: string; href: string }[] = [];
		$('nav a[href], header a[href], [role="navigation"] a[href]').each((_, el) => {
			const href = $(el).attr('href');
			const linkText = $(el).text().trim().slice(0, 80);
			if (!href || !linkText || href.startsWith('#') || href.startsWith('javascript:')) return;
			let resolved: string;
			try { resolved = href.startsWith('http') ? href : new URL(href, url).href; } catch { return; }
			navLinks.push({ text: linkText, href: resolved });
		});

		// Extract images before removing elements
		const images: { src: string; alt: string }[] = [];
		const ogImage = $('meta[property="og:image"]').attr('content') ?? null;
		let ogResolved: string | null = null;
		if (ogImage) {
			try { ogResolved = ogImage.startsWith('http') ? ogImage : new URL(ogImage, url).href; } catch { /* */ }
		}

		$('img[src]').each((_, el) => {
			const src = $(el).attr('src') ?? '';
			if (!src || /\.svg|\.gif|\.ico|spacer|pixel|1x1/i.test(src)) return;
			let resolved: string;
			try { resolved = src.startsWith('http') ? src : new URL(src, url).href; } catch { return; }
			const alt = $(el).attr('alt')?.trim() ?? '';
			images.push({ src: resolved, alt });
		});

		// ── Accordion / collapsible / FAQ / tab content ──────────────────────────
		// These widgets are present in the DOM (cheerio ignores CSS, so collapsed
		// panels are still readable) but typically sit far down the page, so they
		// get lost to the body-text truncation below. Harvest them separately and
		// surface them to the LLM so practical info in accordions isn't missed.
		const expandableChunks: string[] = [];
		const seenExpandable = new Set<string>();
		$(
			'details, summary, [class*="accordion" i], [class*="collaps" i], [class*="faq" i], ' +
				'[class*="expand" i], [class*="toggle" i], [role="tabpanel"], [aria-expanded], [hidden]'
		).each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t.length < 20 || t.length > 1200) return;
			if (seenExpandable.has(t)) return;
			seenExpandable.add(t);
			expandableChunks.push(t);
		});
		const expandableContent = expandableChunks.join('\n').slice(0, 4000) || null;

		// Now remove noise for body text extraction
		$('script, style, nav, footer, aside, .cookie, #cookie, noscript').remove();
		const fullBody = $('body').text().replace(/\s+/g, ' ').trim();
		const bodyText = fullBody.slice(0, 6000);

		// Detect client-rendered / lazy-loaded shells: very little real text in the
		// initial HTML, or an obvious SPA mount point. These need a rendering fallback.
		const spaMarker = /id="(root|app|__next|__nuxt|svelte)"|data-reactroot|ng-version/i.test(html);
		const thin = fullBody.length < 600;
		const needsRender = thin || (spaMarker && fullBody.length < 1500);

		// Extract content links
		const links: { text: string; href: string }[] = [];
		$('a[href]').each((_, el) => {
			const href = $(el).attr('href');
			const linkText = $(el).text().trim().slice(0, 80);
			if (!href || !linkText || href.startsWith('#') || href.startsWith('javascript:')) return;
			let resolved: string;
			try { resolved = href.startsWith('http') ? href : new URL(href, url).href; } catch { return; }
			links.push({ text: linkText, href: resolved });
		});

		return {
			title,
			text: bodyText,
			structuredData,
			expandableContent,
			needsRender,
			navLinks: navLinks.slice(0, 10),
			links: links.slice(0, 15),
			images: images.slice(0, 6),
			ogImage: ogResolved,
			metaDescription: $('meta[name="description"]').attr('content') ??
				$('meta[property="og:description"]').attr('content') ?? null
		};
	} catch {
		return null;
	}
}

// ── Tavily Extract: server-side renderer for JS / lazy-loaded pages ───────────
// Falls back to a hosted renderer that executes JavaScript, so we can read
// content that only appears after the page hydrates or the user scrolls.

async function tavilyExtract(url: string): Promise<{ text: string; images: string[] } | null> {
	if (!env.TAVILY_API_KEY) return null;
	try {
		const res = await fetch('https://api.tavily.com/extract', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				urls: [url],
				extract_depth: 'advanced',
				include_images: true
			}),
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			results?: { raw_content?: string; images?: string[] }[];
		};
		const first = data.results?.[0];
		if (!first?.raw_content) return null;
		return {
			text: first.raw_content.replace(/\s+/g, ' ').trim().slice(0, 6000),
			images: (first.images ?? []).filter((img) => !/logo|icon|favicon|\.svg|\.gif/i.test(img))
		};
	} catch {
		return null;
	}
}

// ── Tavily image search ──────────────────────────────────────────────────────

export async function tavilyImageSearch(query: string): Promise<string[]> {
	if (!env.TAVILY_API_KEY) return [];
	try {
		const res = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				query,
				search_depth: 'basic',
				max_results: 5,
				include_images: true
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return [];
		const data = await res.json() as { images?: string[] };
		return (data.images ?? []).filter((img: string) =>
			!(/logo|icon|favicon|badge|sponsor|\.svg|\.gif/i.test(img))
		);
	} catch {
		return [];
	}
}

/**
 * Build a smart image search query based on the race.
 * For well-known races, includes iconic landmarks. Otherwise uses race name + city + runners.
 */
function buildImageQuery(race: ClassifiedRace): string {
	const name = race.name.replace(/\d{4}/, '').replace(/–.*/, '').trim();
	const km = race.distanceKm ?? 0;
	const type = km >= 42 ? 'marathon' : km >= 21 ? 'half marathon' : 'running race';

	// Well-known race landmarks for better image results
	const landmarks: Record<string, string> = {
		'berlin': 'Brandenburg Gate runners crowd',
		'paris': 'Champs-Élysées runners pack',
		'new york': 'Verrazzano Bridge start crowd',
		'nyc': 'Verrazzano Bridge start crowd',
		'chicago': 'Grant Park runners skyline',
		'london': 'Tower Bridge runners',
		'tokyo': 'Shinjuku runners pack',
		'boston': 'Boylston Street finish crowd',
		'valencia': 'City of Arts runners',
		'stockholm': 'runners Gamla Stan',
		'copenhagen': 'runners waterfront pack',
		'amsterdam': 'runners canals crowd',
		'oslo': 'runners Rådhusplassen start',
		'bergen': 'runners Bryggen crowd',
		'trondheim': 'runners Nidarosdomen',
		'tromsø': 'runners midnight sun crowd',
		'stavanger': 'runners fjord crowd'
	};

	const cityLower = race.city.toLowerCase();
	const landmark = landmarks[cityLower] ?? '';

	if (landmark) {
		return `${name} ${type} ${landmark} photo`;
	}
	return `${name} ${race.city} ${type} runners crowd start line photo`;
}

// ── Agentic enrichment per race ──────────────────────────────────────────────

const ENRICHMENT_SYSTEM = `You are a web research agent finding detailed information about a running race.

GOALS (in priority order):
1. Find the race's OFFICIAL WEBSITE (not kondis.no, friidrett.no, trainerday.com, or any aggregator)
2. Find the exact DATE of the UPCOMING edition (YYYY-MM-DD format):
   - Use the date headline on the official site for THIS year's / the next upcoming edition.
   - IGNORE dates from results pages, archives, or "tidligere løp / previous results" sections — those are PAST editions and will mislead you.
   - The date must be today or in the future. If the site only shows past editions and no upcoming date, return null.
   - If the stored/known date disagrees with the official site, the official site WINS — report the official date.
3. Find ALL DISTANCES offered — e.g. [5, 10] for a race with both 5km and 10km. Report every distance you see on the page.
4. Determine if the race gives a FINISHER MEDAL
4. Find an AMAZING COVER PHOTO — this is the MOST VISIBLE element of the app:
   - PRIORITY 1: RUNNERS IN ACTION — a crowd of runners on the course, sweat, motion, legs pumping
   - PRIORITY 2: COLORFUL & VIBRANT — bright race bibs, confetti, autumn leaves, sunrise/sunset lighting, blue sky
   - PRIORITY 3: RECOGNIZABLE SCENERY — city landmarks behind runners, dramatic nature, crowds cheering
   - NEVER use: logos, icons, maps, medals, trophies, sponsor banners, tiny thumbnails, generic stock photos, screenshots, flyers
   - The og:image on the race's own website is often great IF it shows actual runners — check if it's a real photo vs a graphic/logo
   - If the race website only has a logo/graphic, you MUST use search_images to find a real race photo
   - For your image search, be specific: "[race name] runners [landmark]" or "[race name] start line crowd [year]"
   - A photo with 50+ runners in a pack is ALWAYS better than a single runner or an empty course
5. Find the REGISTRATION URL
6. Find the RESULTS URL — the page where finish times are published AFTER the race. This is usually hosted by a timing company:
   - EQ Timing: look for links like "live.eqtiming.com/event/XXXXX" — must be a SPECIFIC event page, NOT a generic organizationId= schedule page
   - FriRes: "frfrires.no", "results.brighter.io"
   - Ultimate.dk: "live.ultimate.dk/desktop/front/index.php?eventid=XXXXX"
   - Racetimer: "racetimer.se"
   - NEVER return an aggregate calendar page (one with sportIds= or organizationId= and no specific event ID)
   - If the race date is in the future, the results page may not exist yet — return null in that case
7. Find PRACTICAL RACE-DAY INFO that runners always ask about. Look on the official site (often under
   "Praktisk info", "Praktisk", "Info", "For deltakere", "Program", "Start", "Henting av startnummer"):
   - venueAddress: the address / clear location of the start-finish area or event venue
   - startTimes: start time(s) for the distances or waves (or opening time / first start if many waves)
   - bibPickup: where and when to collect race numbers/bibs (place + days/hours)
   - facilities: toilets, changing rooms, wardrobe / bag storage
   - extras: food & drink, expo, entertainment, kids races, after-party or other side events
   Report ONLY what the page actually states. Leave any field null if you don't find it — do NOT guess or
   invent. It is fine (and expected) for several of these to be null.

STRATEGY:
- Visit the source URL first. Look for links to the race's own website.
- Visit the official website. Look for dates, medal info, photos.
- The visit_page result includes a "structuredData" field (JSON-LD / hydration data) and an "expandableContent" field (text pulled from accordions / FAQ / collapsible panels), and it renders JavaScript/lazy-loaded pages automatically — check BOTH structuredData and expandableContent for dates, locations, practical info and event details, especially when the visible pageText looks sparse.
- FOLLOW INTERNAL LINKS to fill gaps. After each page, look at what is still MISSING (date, distances, medal, registration, results, practical info) and use the "navigationMenu" and "links" from the result to open the most relevant internal page on the SAME official site. Good link texts to follow:
   - Date / program: "Program", "Tidsskjema", "Praktisk info", "Praktisk", "Info", "For deltakere", "Start"
   - Distances: "Distanser", "Løp", "Klasser", "Påmelding"
   - Medal: "Premiering", "Premier", "Medalje", "Medaljer"
   - Registration: "Påmelding", "Meld deg på", "Register", "Tilmelding"
   - Results: "Resultater", "Results", "Live", "Tidtaking"
   - Practical info: "Praktisk info", "Henting av startnummer", "Parkering", "Garderobe"
- Keep navigating internal links of the official site until you have found every field you reasonably can, OR you have followed the relevant links and the info simply isn't published. Then STOP and report — don't keep visiting once the obvious internal pages are exhausted.
- Stay on the race's OWN domain when following links for facts. Don't wander off into sponsors, social media, or unrelated sites.
- MEDAL DETECTION for Norwegian races: Look for menu items or links containing "Premiering", "Medalje", "Medaljer", "Premier". If you find such a link, the race gives medals — report medal_status as "confirmed". You don't need to click into it.
- COVER PHOTO: Check the og:image first. Only use it if it clearly shows RUNNERS (humans in athletic gear running). If it's a logo, graphic, or empty landscape — ignore it and search for a better one.
- ALWAYS use search_images if the og:image is not a runner photo. Most races have amazing crowd shots available.
- For search queries, include terms like "runners", "crowd", "start", "finish line", "pack" plus the race name and city/landmark.
- RACE-DAY INFO: actively open the official site's "Praktisk info" / "Program" / "For deltakere" page (follow the internal link) and grab address, start times, bib pickup, facilities and side events. Report ONLY what's stated; leave fields null if not published.
- Be efficient but thorough: you have up to ~12 tool calls. Prefer following internal links over giving up early, but don't revisit pages you've already seen or open clearly irrelevant pages.

ALWAYS call report_findings at the end with your results.`;

async function enrichOneWithAgent(
	race: ClassifiedRace,
	onLog: (msg: string) => void
): Promise<EnrichmentResult> {
	const result: EnrichmentResult = {};

	const raceInfo = [
		`Race: "${race.name}"`,
		`City: ${race.city}, ${race.country}`,
		`Distance: ${race.distanceKm ?? '?'}km`,
		`Category: ${race.category}`,
		`Source URL: ${race.sourceUrl}`,
		`Known date: ${race.raceDate ? race.raceDate.toISOString().split('T')[0] : 'UNKNOWN — please find it'}`,
		`Medal status: ${race.medalStatus}`,
		`Registration URL: ${race.registrationUrl ?? 'UNKNOWN — please find it'}`,
		'',
		'Visit the source URL and explore from there. Find official site, date, medal, photo, registration.'
	].join('\n');

	try {
		await generateText({
			model: getModel(),
			system: ENRICHMENT_SYSTEM,
			prompt: raceInfo,
			stopWhen: stepCountIs(12),
			tools: {
				visit_page: tool({
					description: 'Fetch a web page. Returns page text, embedded structured data, accordion/FAQ/collapsible content, key links, images, and og:image. Handles JavaScript / lazy-loaded pages via a rendering fallback. Be selective about what pages to visit.',
					inputSchema: z.object({
						url: z.string().url().describe('URL to visit'),
						reason: z.string().describe('Why visiting this page')
					}),
					execute: async ({ url, reason }) => {
						onLog(`    🌐 ${new URL(url).hostname}: ${reason}`);
						const page = await fetchAndParse(url);

						// If the page is empty/lazy-loaded (or fetch failed), render it
						// server-side with Tavily Extract so we can read JS-injected content.
						let pageText = page?.text ?? '';
						let renderImages: string[] = [];
						if (!page || page.needsRender) {
							const rendered = await tavilyExtract(url);
							if (rendered && rendered.text.length > (page?.text.length ?? 0)) {
								onLog(`    🖥️ rendered ${new URL(url).hostname} (lazy/JS content)`);
								pageText = rendered.text;
								renderImages = rendered.images;
							}
						}

						if (!page && !pageText) return { error: `Could not fetch ${url}` };

						return {
							title: page?.title ?? '',
							description: page?.metaDescription ?? null,
							pageText,
							structuredData: page?.structuredData ?? null,
							expandableContent: page?.expandableContent ?? null,
							ogImage: page?.ogImage ?? null,
							navigationMenu: page?.navLinks ?? [],
							links: page?.links ?? [],
							images: [
								...(page?.images ?? []),
								...renderImages.map((src) => ({ src, alt: '' }))
							].slice(0, 8)
						};
					}
				}),
				search_images: tool({
					description: 'Search for REAL PHOTOS of runners at this race. Use this if the website og:image is a logo/graphic. Prefer queries that will return crowd shots of runners in action with landmarks visible.',
					inputSchema: z.object({
						query: z.string().describe('Specific image search query, e.g. "Berlin Marathon runners Brandenburg Gate crowd 2025" — always include "runners" and a landmark')
					}),
					execute: async ({ query }) => {
						onLog(`    🔍 searching images: "${query}"`);
						const images = await tavilyImageSearch(query);
						if (images.length === 0) return { images: [], note: 'No images found. Try a different query.' };
						return { images };
					}
				}),
				report_findings: tool({
					description: 'Submit your research findings. ALWAYS call this when done.',
					inputSchema: z.object({
						websiteUrl: z.string().nullable().describe('Official race website (not aggregator)'),
						raceDateIso: z.string().nullable().describe('Date of the UPCOMING edition as YYYY-MM-DD, taken from the official site headline. Must be today or later. NOT a date from a results/archive page. Null if no upcoming date is shown.'),
						medalStatus: z.enum(['confirmed', 'likely', 'unclear']),
						imageUrl: z.string().nullable().describe('URL of an AMAZING photo showing RUNNERS IN ACTION — crowd shots, packs of runners, start/finish lines with people. NEVER a logo or graphic.'),
						registrationUrl: z.string().nullable().describe('Direct signup URL'),
						resultsUrl: z.string().nullable().describe('Timing results page URL — must be a SPECIFIC event page on a timing provider (eqtiming.com/event/XXX, ultimate.dk?eventid=XXX, etc.). NOT a generic schedule/calendar page.').optional(),
						distancesKm: z.array(z.number()).nullable().optional().describe('ALL distances offered at this event in km, e.g. [5, 10] for a race with both 5km and 10km. Only set if you found explicit distance info on the page.'),
						registrationDeadlineIso: z.string().nullable().optional().describe('Last day to register as YYYY-MM-DD, if explicitly stated.'),
						priceMin: z.number().nullable().optional().describe('Cheapest entry fee as a number (no currency symbol), if listed.'),
						priceMax: z.number().nullable().optional().describe('Most expensive entry fee as a number, if a range is listed.'),
						priceCurrency: z.string().nullable().optional().describe('ISO currency code for the price, e.g. "NOK", "EUR", "USD".'),
						fieldSize: z.number().nullable().optional().describe('Participant capacity or typical field size, if published.'),
						elevationGainM: z.number().nullable().optional().describe('Total elevation gain in metres, if stated (key for trail/fjell races).'),
						surface: z.enum(['road', 'trail', 'mixed', 'track']).nullable().optional().describe('Primary running surface.'),
						venueAddress: z.string().nullable().optional().describe('Street address or clear location of the start/finish area or event venue, e.g. "Festplassen, 5014 Bergen". Null if not stated on the page.'),
						startTimes: z.string().nullable().optional().describe('Start time(s) for the distances/waves exactly as written, e.g. "10K 19:00, 5K 19:15". For many waves give the range or first start, e.g. "first start 09:00, last wave 11:30". Null if not stated.'),
						bibPickup: z.string().nullable().optional().describe('Where and when to collect race numbers/bibs, e.g. "XXL Lagunen, Fri 15:00–19:00 & from 1h before start". Null if not stated.'),
						facilities: z.string().nullable().optional().describe('Toilets, changing rooms, wardrobe / bag storage info, e.g. "Toilets & bag drop at the stadium". Null if not stated.'),
						extras: z.string().nullable().optional().describe('Food, drink, expo, entertainment, kids races, after-party or other side events, e.g. "Food trucks, live music, kids 1K". Null if not stated.'),
						confidence: z.number().min(0).max(1).nullable().optional().describe('Your overall confidence (0–1) that the extracted facts are correct and from the official source.'),
						reasoning: z.string().describe('Brief explanation of findings. For image: describe what the photo shows (runners? crowd? landmark?).')
					}),
					execute: async (findings) => {
						if (findings.websiteUrl) result.websiteUrl = findings.websiteUrl;
						if (findings.raceDateIso) result.raceDate = findings.raceDateIso;
						if (findings.medalStatus !== 'unclear') result.medalStatus = findings.medalStatus;
						if (findings.imageUrl) result.imageUrl = findings.imageUrl;
						if (findings.registrationUrl) result.registrationUrl = findings.registrationUrl;
						if (findings.resultsUrl) result.resultsUrl = findings.resultsUrl;
						if (findings.distancesKm && findings.distancesKm.length > 0) result.distancesKm = findings.distancesKm;
						if (findings.registrationDeadlineIso) result.registrationDeadline = findings.registrationDeadlineIso;
						if (findings.priceMin != null) result.priceMin = findings.priceMin;
						if (findings.priceMax != null) result.priceMax = findings.priceMax;
						if (findings.priceCurrency) result.priceCurrency = findings.priceCurrency;
						if (findings.fieldSize != null) result.fieldSize = findings.fieldSize;
						if (findings.elevationGainM != null) result.elevationGainM = findings.elevationGainM;
						if (findings.surface) result.surface = findings.surface;
						const rdi: RaceDayInfo = {};
						if (findings.venueAddress) rdi.address = findings.venueAddress;
						if (findings.startTimes) rdi.startTimes = findings.startTimes;
						if (findings.bibPickup) rdi.bibPickup = findings.bibPickup;
						if (findings.facilities) rdi.facilities = findings.facilities;
						if (findings.extras) rdi.extras = findings.extras;
						if (Object.keys(rdi).length > 0) result.raceDayInfo = rdi;
						if (findings.confidence != null) result.confidence = findings.confidence;
						onLog(`    📋 ${findings.reasoning}`);
						return { recorded: true };
					}
				})
			}
		});
	} catch (err) {
		onLog(`    ⚠️ agent failed for ${race.name}: ${err instanceof Error ? err.message : String(err)}`);
	}

	return result;
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function enrichRaces(
	classified: ClassifiedRace[],
	onLog: (msg: string) => void
): Promise<ClassifiedRace[]> {
	if (classified.length === 0) return classified;
	onLog(`🔬 Enriching ${classified.length} races (Claude agent exploring the web)…`);

	const enriched = [...classified];

	for (let i = 0; i < enriched.length; i++) {
		const race = enriched[i];
		onLog(`  [${i + 1}/${enriched.length}] ${race.name}`);

		// Pause 5s between races to stay under 30k tokens/min rate limit
		if (i > 0) await new Promise((r) => setTimeout(r, 5000));

		let data: EnrichmentResult = {};
		try {
			data = await enrichOneWithAgent(race, onLog);
		} catch {
			// already logged inside enrichOneWithAgent
		}

		if (data.raceDate && !race.raceDate) race.raceDate = new Date(data.raceDate);
		// Date correction: the agent reads the official site, which is authoritative.
		// If it found a (future) date that disagrees with the stored one, trust the agent
		// and overwrite — this fixes stale dates carried over from past editions.
		if (data.raceDate && race.raceDate) {
			const found = new Date(data.raceDate);
			const isFuture = found.getTime() >= Date.now() - 86_400_000;
			const differs = found.toISOString().split('T')[0] !== race.raceDate.toISOString().split('T')[0];
			if (isFuture && differs) {
				onLog(`    📅 corrected date ${race.raceDate.toISOString().split('T')[0]} → ${data.raceDate} (official source)`);
				race.raceDate = found;
			}
		}
		if (data.registrationUrl && !race.registrationUrl) race.registrationUrl = data.registrationUrl;
		if (data.resultsUrl && !race.resultsUrl) race.resultsUrl = data.resultsUrl;
		if (data.websiteUrl) race.websiteUrl = data.websiteUrl;
		if (data.imageUrl) race.imageUrl = data.imageUrl;
		if (data.medalStatus && race.medalStatus !== 'confirmed') race.medalStatus = data.medalStatus;
		if (data.distancesKm && data.distancesKm.length > 1) race.enrichedDistancesKm = data.distancesKm;
		if (data.registrationDeadline) race.registrationDeadline = new Date(data.registrationDeadline);
		if (data.priceMin != null) race.priceMin = data.priceMin;
		if (data.priceMax != null) race.priceMax = data.priceMax;
		if (data.priceCurrency) race.priceCurrency = data.priceCurrency;
		if (data.fieldSize != null) race.fieldSize = data.fieldSize;
		if (data.elevationGainM != null) race.elevationGainM = data.elevationGainM;
		if (data.surface) race.surface = data.surface;
		if (data.raceDayInfo) {
			// Merge field-by-field so a later pass can fill gaps without wiping prior finds
			race.raceDayInfo = { ...(race.raceDayInfo ?? {}), ...data.raceDayInfo };
		}
		if (data.confidence != null) race.confidence = data.confidence;
	}

	// ── Fast image fallback: for any race the agent missed, just search directly ──
	const noImage = enriched.filter((r) => !r.imageUrl);
	if (noImage.length > 0) {
		onLog(`📸 ${noImage.length} races still need images — running direct search…`);
		for (const race of noImage) {
			const query = buildImageQuery(race);
			const images = await tavilyImageSearch(query);
			if (images.length > 0) {
				race.imageUrl = images[0];
				onLog(`    ✓ ${race.name}: found image via "${query}"`);
			} else {
				onLog(`    ✗ ${race.name}: no image found`);
			}
			// Small delay to not hammer Tavily
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	const withDate = enriched.filter((r) => r.raceDate).length;
	const withImage = enriched.filter((r) => r.imageUrl).length;
	const withSite = enriched.filter((r) => r.websiteUrl).length;
	onLog(`✅ Enrichment: ${withDate}/${enriched.length} dates, ${withImage}/${enriched.length} images, ${withSite}/${enriched.length} websites`);

	return enriched;
}
