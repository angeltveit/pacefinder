import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

const BASE_URL = 'https://www.sportstiming.dk';

/** Try to extract a date (YYYY-MM-DD) from text like "01-06-2026" or "2026-06-01" */
function extractDate(text: string): string | undefined {
	// DD-MM-YYYY or DD/MM/YYYY
	const dmy = text.match(/(\d{2})[\-/](\d{2})[\-/](\d{4})/);
	if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
	// YYYY-MM-DD
	const ymd = text.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (ymd) return ymd[0];
	return undefined;
}
const EVENTS_URL = `${BASE_URL}/events`;
const MAX_PAGES = 9;

/**
 * Scrape SportsTiming.dk event calendar for running events.
 * Covers Denmark and Sweden primarily.
 * Filters to running-type events only at scrape time.
 */
export async function scrapeSportsTiming(): Promise<RawRaceLead[]> {
	const leads: RawRaceLead[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= MAX_PAGES; page++) {
		try {
			const url = page === 1 ? EVENTS_URL : `${EVENTS_URL}?page=${page}`;
			const res = await fetch(url, {
				headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) break;

			const html = await res.text();
			const $ = cheerio.load(html);

			// SportsTiming uses a table format with columns: Date | Type | Event | Location | Status
			$('table tr, .event-row, [class*="event"]').each((_, row) => {
				const text = $(row).text().replace(/\s+/g, ' ').trim();
				if (!text) return;

				// Only include running events (Run, Trail run)
				const isRunning = /\bRun\b|Trail run/i.test(text);
				if (!isRunning) return;

				// Extract event link
				const link = $(row).find('a[href*="/event/"]').first();
				const href = link.attr('href');
				const name = link.text().trim();
				if (!name || !href || seen.has(href)) return;
				seen.add(href);

				// Extract location (city)
				const cells = $(row).find('td');
				let city = '';
				if (cells.length >= 4) {
					city = $(cells[3]).text().trim();
				}

				const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

				leads.push({
					name: name.replace(/\s+/g, ' ').trim(),
					url: fullUrl,
					description: city ? `Location: ${city}` : undefined,
					source: 'sportstiming',
					rawText: text.slice(0, 300),
					date: extractDate(text)
				});
			});

			// Also try a more generic approach parsing the HTML table rows
			$('tr').each((_, row) => {
				const rowText = $(row).text().replace(/\s+/g, ' ').trim();
				if (!rowText) return;

				// Match rows that contain "Run" or "Trail run" as event type
				if (!/\bRun\b|Trail run/i.test(rowText)) return;

				// Skip triathlons, cycling, etc that might also mention "run"
				if (/Triathlon|Cycling|MTB|Swim|Duathlon|BMX|Gravel/i.test(rowText)) return;

				const link = $(row).find('a[href]').first();
				const href = link.attr('href') ?? '';
				const name = link.text().trim();

				if (!name || name.length < 3 || seen.has(href)) return;
				if (!href.includes('/event/') && !href.includes('/events/')) return;
				seen.add(href);

				const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

				leads.push({
					name,
					url: fullUrl,
					source: 'sportstiming',
					rawText: rowText.slice(0, 300),
					date: extractDate(rowText)
				});
			});
		} catch {
			// Continue to next page on error
		}
	}

	return leads;
}
