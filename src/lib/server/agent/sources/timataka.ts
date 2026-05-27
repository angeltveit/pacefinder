import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

const CALENDAR_URL = 'https://www.timataka.net/calendar/';

/**
 * Scrape timataka.net race calendar for Icelandic running events.
 * The calendar page lists all events chronologically by month.
 * We only take future events and filter out non-running sports at scrape time.
 */
export async function scrapeTimataka(): Promise<RawRaceLead[]> {
	try {
		const res = await fetch(CALENDAR_URL, {
			headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];

		const html = await res.text();
		const $ = cheerio.load(html);
		const leads: RawRaceLead[] = [];
		const seen = new Set<string>();
		const now = new Date();

		// Non-running event keywords to exclude
		const excludePatterns = [
			/\bcycl/i, /\bhjól/i, /\bfjallahjól/i, /\bdownhill\b/i, /\bDH\b/,
			/\bEnduro\b/i, /\bMTB\b/i, /\bBMX\b/i, /\bXCO?\b/, /\bCriterium\b/i,
			/\btímataka\b.*\bTT\b/i, /\bTT:/i, /\bþríþraut/i, /\btriathlon/i,
			/\bsund\b/i, /\bswim/i, /\bskíð/i, /\bski\b/i, /\bsleðahund/i,
			/\bgangan\b/i, // walking/ski traverses
			/\bbiathlon/i, /\bsleðar\b/i, /\bPrologue\b/i,
			/\bCyclocross\b/i, /\bCX\b/, /\bgötuhjól/i, /\bRR\b/
		];

		// The calendar is organized as bullet lists under month headings
		let currentYear: number | null = null;
		let currentMonth: number | null = null;

		// Parse month headings to determine year/month context
		const monthMap: Record<string, number> = {
			'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'maí': 4, 'may': 4,
			'jún': 5, 'jun': 5, 'júl': 6, 'jul': 6, 'ág': 7, 'aug': 7,
			'sep': 8, 'okt': 9, 'oct': 9, 'nóv': 10, 'nov': 10, 'des': 11, 'dec': 11
		};

		$('h3, li').each((_, el) => {
			const tag = el.tagName?.toLowerCase();
			const text = $(el).text().trim();

			if (tag === 'h3') {
				// Parse "May 2026" or "Maí 2026" etc.
				const match = text.match(/(\w+)\s+(\d{4})/);
				if (match) {
					const monthStr = match[1].toLowerCase().slice(0, 3);
					const year = parseInt(match[2]);
					const monthNum = monthMap[monthStr];
					if (monthNum !== undefined) {
						currentYear = year;
						currentMonth = monthNum;
					}
				}
				return;
			}

			if (tag === 'li') {
				const link = $(el).find('a[href]').first();
				const href = link.attr('href') ?? '';
				const name = link.text().trim();

				if (!name || !href || seen.has(href)) return;

				// Skip non-running events
				if (excludePatterns.some(p => p.test(name))) return;

				seen.add(href);

				// Parse date from the text (format: "(30. maí)" or "(29. maí)")
				const dateMatch = text.match(/\((\d{1,2})\.\s*(\w+)\)/);
				let eventDate: Date | null = null;
				if (dateMatch && currentYear !== null) {
					const day = parseInt(dateMatch[1]);
					const monthStr = dateMatch[2].toLowerCase().slice(0, 3);
					const monthNum = monthMap[monthStr];
					if (monthNum !== undefined) {
						eventDate = new Date(currentYear, monthNum, day);
					}
				} else if (currentYear !== null && currentMonth !== null) {
					eventDate = new Date(currentYear, currentMonth, 1);
				}

				// Only include future events
				if (eventDate && eventDate < now) return;

				const fullUrl = href.startsWith('http') ? href : `https://timataka.net${href}`;
				const dateStr = eventDate ? eventDate.toISOString().split('T')[0] : '';

				leads.push({
					name,
					url: fullUrl,
					description: dateStr ? `Date: ${dateStr}, Iceland` : 'Iceland',
					source: 'timataka',
					rawText: `${name} — Iceland — ${dateStr}`,
					date: dateStr || undefined
				});
			}
		});

		return leads;
	} catch {
		return [];
	}
}
