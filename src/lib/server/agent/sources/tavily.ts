import { env } from '$env/dynamic/private';
import type { RawRaceLead } from '../types';

const QUERIES = [
	// Local Bergen (specific races)
	'site:bergenslopet.no OR site:bergencitymarathon.no OR site:sommernattslopet.no 2026',
	'5km 10km løp Bergen Vestland 2026 finisher medalje påmelding',
	'Bergen halvmaraton maraton løp 2026 2027 medal registration',
	// Norwegian halfs and marathons (specific cities)
	'Oslo Maraton halvmaraton 2026 påmelding medal',
	'Stavanger Marathon halvmaraton 2026 registration',
	'Trondheim Maraton 2026 halvmaraton påmelding',
	'Tromsø Midnight Sun Marathon 2026 registration medal',
	'halvmaraton Norge 2026 Kristiansand Ålesund Bodø Drammen Fredrikstad medal',
	// International majors
	'Berlin Marathon 2026 registration entry',
	'New York City Marathon 2026 entry registration',
	'Paris Marathon 2027 inscription registration',
	'London Marathon 2026 2027 entry ballot',
	'Chicago Tokyo Boston Valencia marathon 2026 2027 registration',
	'Copenhagen Stockholm Amsterdam marathon half marathon 2026 2027',
	// Discovery
	'site:kondis.no løp Bergen Hordaland 2026 2027',
	'scenic trail marathon half marathon bucket list Europe 2026 2027 medal'
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
