import { env } from '$env/dynamic/private';
import type { RawRaceLead } from '../types';

const QUERIES = [
	'5km 10km løp Bergen 2026 2027 finisher medal',
	'halvmaraton Oslo Trondheim Stavanger Tromsø 2026 2027 medal',
	'Berlin London New York Chicago Tokyo Boston Paris Valencia marathon 2026 2027 registration',
	'Norwegian running race medal 2026 2027 registration open',
	'scenic marathon half marathon bucket list 2026 2027'
];

interface TavilyResult {
	title: string;
	url: string;
	content: string;
}

export async function searchTavily(): Promise<RawRaceLead[]> {
	if (!env.TAVILY_API_KEY) return [];

	const leads: RawRaceLead[] = [];

	for (const query of QUERIES) {
		try {
			const res = await fetch('https://api.tavily.com/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					api_key: env.TAVILY_API_KEY,
					query,
					search_depth: 'basic',
					max_results: 5
				}),
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) continue;

			const data = (await res.json()) as { results?: TavilyResult[] };
			for (const r of data.results ?? []) {
				leads.push({
					name: r.title,
					url: r.url,
					description: r.content.slice(0, 400),
					source: 'tavily'
				});
			}
		} catch {
			// skip this query on error
		}
	}

	return leads;
}
