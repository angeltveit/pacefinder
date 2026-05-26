/**
 * Agentic enrichment: gives Claude tools to browse the web and find
 * official websites, dates, medal info, and cover photos for each race.
 * Claude decides what pages to visit and what links to follow.
 */
import { generateText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';
import type { ClassifiedRace } from './types';

interface EnrichmentResult {
	raceDate?: string;
	registrationUrl?: string;
	resultsUrl?: string;
	websiteUrl?: string;
	imageUrl?: string;
	medalStatus?: 'confirmed' | 'likely' | 'unclear';
	distancesKm?: number[];
}

// ── LLM setup ────────────────────────────────────────────────────────────────

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

async function fetchAndParse(url: string) {
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

		// Now remove noise for body text extraction
		$('script, style, nav, footer, aside, .cookie, #cookie, noscript').remove();
		const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);

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

// ── Tavily image search ──────────────────────────────────────────────────────

async function tavilyImageSearch(query: string): Promise<string[]> {
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
2. Find the exact DATE (YYYY-MM-DD format)
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

STRATEGY:
- Visit the source URL first. Look for links to the race's own website.
- Visit the official website. Look for dates, medal info, photos.
- MEDAL DETECTION for Norwegian races: Look for menu items or links containing "Premiering", "Medalje", "Medaljer", "Premier". If you find such a link, the race gives medals — report medal_status as "confirmed". You don't need to click into it.
- COVER PHOTO: Check the og:image first. Only use it if it clearly shows RUNNERS (humans in athletic gear running). If it's a logo, graphic, or empty landscape — ignore it and search for a better one.
- ALWAYS use search_images if the og:image is not a runner photo. Most races have amazing crowd shots available.
- For search queries, include terms like "runners", "crowd", "start", "finish line", "pack" plus the race name and city/landmark.
- Be efficient: max 4 tool uses. Don't visit clearly irrelevant pages.

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
			maxSteps: 4,
			tools: {
				visit_page: tool({
					description: 'Fetch a web page. Returns page text (truncated), key links, images, and og:image. Be selective about what pages to visit.',
					parameters: z.object({
						url: z.string().url().describe('URL to visit'),
						reason: z.string().describe('Why visiting this page')
					}),
					execute: async ({ url, reason }) => {
						onLog(`    🌐 ${new URL(url).hostname}: ${reason}`);
						const page = await fetchAndParse(url);
						if (!page) return { error: `Could not fetch ${url}` };
						return {
							title: page.title,
							description: page.metaDescription,
							pageText: page.text,
							ogImage: page.ogImage,
							navigationMenu: page.navLinks,
							links: page.links,
							images: page.images
						};
					}
				}),
				search_images: tool({
					description: 'Search for REAL PHOTOS of runners at this race. Use this if the website og:image is a logo/graphic. Prefer queries that will return crowd shots of runners in action with landmarks visible.',
					parameters: z.object({
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
					parameters: z.object({
						websiteUrl: z.string().nullable().describe('Official race website (not aggregator)'),
						raceDateIso: z.string().nullable().describe('Date as YYYY-MM-DD'),
						medalStatus: z.enum(['confirmed', 'likely', 'unclear']),
						imageUrl: z.string().nullable().describe('URL of an AMAZING photo showing RUNNERS IN ACTION — crowd shots, packs of runners, start/finish lines with people. NEVER a logo or graphic.'),
						registrationUrl: z.string().nullable().describe('Direct signup URL'),
						resultsUrl: z.string().nullable().describe('Timing results page URL — must be a SPECIFIC event page on a timing provider (eqtiming.com/event/XXX, ultimate.dk?eventid=XXX, etc.). NOT a generic schedule/calendar page.').optional(),
						distancesKm: z.array(z.number()).nullable().optional().describe('ALL distances offered at this event in km, e.g. [5, 10] for a race with both 5km and 10km. Only set if you found explicit distance info on the page.'),
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
		if (data.registrationUrl && !race.registrationUrl) race.registrationUrl = data.registrationUrl;
		if (data.resultsUrl && !race.resultsUrl) race.resultsUrl = data.resultsUrl;
		if (data.websiteUrl) race.websiteUrl = data.websiteUrl;
		if (data.imageUrl) race.imageUrl = data.imageUrl;
		if (data.medalStatus && race.medalStatus !== 'confirmed') race.medalStatus = data.medalStatus;
		if (data.distancesKm && data.distancesKm.length > 1) race.enrichedDistancesKm = data.distancesKm;
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
