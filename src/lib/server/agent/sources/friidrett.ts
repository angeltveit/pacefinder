import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

export async function scrapeFriidrett(): Promise<RawRaceLead[]> {
	try {
		const res = await fetch('https://www.friidrett.no/kalender/', {
			headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];

		const html = await res.text();
		const $ = cheerio.load(html);
		const leads: RawRaceLead[] = [];
		const seen = new Set<string>();

		// friidrett.no calendar links — LLM will filter out non-running events
		$('a[href*="/kalender/"]').each((_, el) => {
			const $el = $(el);
			const href = $el.attr('href') ?? '';
			if (!href.match(/\/kalender\/[^/]+\/?$/)) return;
			const rawText = $el.closest('li, div, p').text().replace(/\s+/g, ' ').trim();
			const name = rawText.slice(0, 120) || $el.text().trim();
			if (!name || name.length < 5 || seen.has(href)) return;
			seen.add(href);
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
