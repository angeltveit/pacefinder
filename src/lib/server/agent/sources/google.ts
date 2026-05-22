import { env } from '$env/dynamic/private';
import type { RawRaceLead } from '../types';

const QUERIES = [
	'running race Bergen medal 2026 site:kondis.no OR site:racetracker.no',
	'halvmaraton Norway medal 2026 2027',
	'marathon 2026 registration open Berlin London Valencia'
];

interface GoogleItem {
	title: string;
	link: string;
	snippet: string;
}

export async function searchGoogle(): Promise<RawRaceLead[]> {
	if (!env.GOOGLE_CSE_ID || !env.GOOGLE_CSE_API_KEY) return [];

	const leads: RawRaceLead[] = [];

	for (const q of QUERIES) {
		try {
			const url = new URL('https://www.googleapis.com/customsearch/v1');
			url.searchParams.set('key', env.GOOGLE_CSE_API_KEY);
			url.searchParams.set('cx', env.GOOGLE_CSE_ID);
			url.searchParams.set('q', q);
			url.searchParams.set('num', '5');

			const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
			if (!res.ok) continue;

			const data = (await res.json()) as { items?: GoogleItem[] };
			for (const item of data.items ?? []) {
				leads.push({
					name: item.title,
					url: item.link,
					description: item.snippet,
					source: 'google'
				});
			}
		} catch {
			// skip
		}
	}

	return leads;
}
