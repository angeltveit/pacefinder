import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

export async function scrapeFriidrett(): Promise<RawRaceLead[]> {
	try {
		const res = await fetch('https://www.friidrett.no/stevner/', {
			headers: { 'User-Agent': 'RaceScout/1.0 (research bot)' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];

		const html = await res.text();
		const $ = cheerio.load(html);
		const leads: RawRaceLead[] = [];

		$('a[href*="stevne"], a[href*="race"], a[href*="løp"], .event a, .race a').each((_, el) => {
			const $el = $(el);
			const name = $el.text().trim();
			const href = $el.attr('href');
			if (!name || !href || name.length < 4) return;

			leads.push({
				name,
				url: href.startsWith('http') ? href : `https://www.friidrett.no${href}`,
				source: 'friidrett'
			});
		});

		return leads;
	} catch {
		return [];
	}
}
