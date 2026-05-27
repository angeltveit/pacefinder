import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

const BASE_URL = 'https://www.racetimer.se';

/** Try to extract a date (YYYY-MM-DD) from text */
function extractDate(text: string): string | undefined {
	// YYYY-MM-DD
	const ymd = text.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (ymd) return ymd[0];
	// DD/MM/YYYY or DD-MM-YYYY
	const dmy = text.match(/(\d{2})[\-/](\d{2})[\-/](\d{4})/);
	if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
	return undefined;
}
const COMING_URL = `${BASE_URL}/sv/races/coming`;
const MAX_PAGES = 5;

/**
 * Scrape RaceTimer.se for upcoming Swedish running events.
 * RaceTimer is Sweden's primary timing company (~400 events/year).
 */
export async function scrapeRaceTimer(): Promise<RawRaceLead[]> {
	const leads: RawRaceLead[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= MAX_PAGES; page++) {
		try {
			const url = page === 1 ? COMING_URL : `${COMING_URL}?page_coming=${page}`;
			const res = await fetch(url, {
				headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) break;

			const html = await res.text();
			const $ = cheerio.load(html);

			// RaceTimer lists events as links in a paginated list
			$('a[href*="/sv/race/"], a[href*="/en/race/"]').each((_, el) => {
				const href = $(el).attr('href') ?? '';
				if (!href || seen.has(href)) return;

				const name = $(el).text().trim();
				if (!name || name.length < 3) return;

				// Skip non-running event types
				const nameLower = name.toLowerCase();
				if (/cykel|cycling|mtb|triathlon|simning|swim|ski|skidor|orientering/i.test(nameLower)) return;

				seen.add(href);
				const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

				// Try to get surrounding text for date/location context
				const parent = $(el).closest('li, tr, div, article');
				const rawText = parent.text().replace(/\s+/g, ' ').trim().slice(0, 300);

				leads.push({
					name,
					url: fullUrl,
					description: rawText !== name ? rawText : undefined,
					source: 'racetimer',
					rawText: rawText || name,
					date: extractDate(rawText)
				});
			});

			// Also try parsing structured data if present
			$('[class*="race"], [class*="event"]').each((_, el) => {
				const link = $(el).find('a[href*="/race/"]').first();
				const href = link.attr('href') ?? '';
				if (!href || seen.has(href)) return;

				const name = link.text().trim();
				if (!name || name.length < 3) return;

				const nameLower = name.toLowerCase();
				if (/cykel|cycling|mtb|triathlon|simning|swim|ski|skidor|orientering/i.test(nameLower)) return;

				seen.add(href);
				const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
				const rawText = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 300);

				leads.push({
					name,
					url: fullUrl,
					description: rawText,
					source: 'racetimer',
					rawText,
					date: extractDate(rawText)
				});
			});
		} catch {
			// Continue on error
		}
	}

	return leads;
}
