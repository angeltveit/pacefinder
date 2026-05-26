import * as cheerio from 'cheerio';
import type { RawRaceLead } from '../types';

export async function scrapeKondis(): Promise<RawRaceLead[]> {
	try {
		const res = await fetch('https://www.kondis.no/lopsguiden', {
			headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return [];

		const html = await res.text();
		const $ = cheerio.load(html);
		const leads: RawRaceLead[] = [];
		const seen = new Set<string>();

		// Løpsguiden entries are plain links with href matching /lopsguiden/<slug>/<id>
		$('a[href*="/lopsguiden/"]').each((_, el) => {
			const $el = $(el);
			const href = $el.attr('href') ?? '';
			// Skip non-entry links (e.g. the section header itself)
			if (!href.match(/\/lopsguiden\/[^/]+\/\d+/)) return;
			const name = $el.text().trim();
			if (!name || name.length < 4 || seen.has(href)) return;
			seen.add(href);
			leads.push({
				name,
				url: href.startsWith('http') ? href : `https://www.kondis.no${href}`,
				description: name, // title already contains date info
				source: 'kondis'
			});
		});

		return leads;
	} catch {
		return [];
	}
}
