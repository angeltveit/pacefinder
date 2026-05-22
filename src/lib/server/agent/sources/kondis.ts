import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

export async function scrapeKondis(): Promise<RawRaceLead[]> {
	try {
		const res = await fetch('https://www.kondis.no/kalender/', {
			headers: { 'User-Agent': 'RaceScout/1.0 (research bot)' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];

		const html = await res.text();
		const $ = cheerio.load(html);
		const leads: RawRaceLead[] = [];

		// kondis.no race calendar — selectors may need adjusting if site changes
		$('.race-item, .event-item, article.race, tr.race-row').each((_, el) => {
			const $el = $(el);
			const name = $el.find('a').first().text().trim();
			const href = $el.find('a').first().attr('href');
			const description = $el.text().replace(/\s+/g, ' ').trim().slice(0, 400);

			if (name && href) {
				leads.push({
					name,
					url: href.startsWith('http') ? href : `https://www.kondis.no${href}`,
					description,
					source: 'kondis'
				});
			}
		});

		return leads;
	} catch {
		return [];
	}
}
