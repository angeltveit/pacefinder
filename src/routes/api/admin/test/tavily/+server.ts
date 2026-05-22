import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	if (!env.TAVILY_API_KEY) {
		return json({ ok: false, error: 'TAVILY_API_KEY is not set' });
	}

	try {
		const res = await fetch('https://api.tavily.com/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.TAVILY_API_KEY,
				query: 'running race Bergen 2026',
				search_depth: 'basic',
				max_results: 1
			}),
			signal: AbortSignal.timeout(10_000)
		});

		if (!res.ok) {
			const text = await res.text();
			return json({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` });
		}

		const data = await res.json();
		const count = data.results?.length ?? 0;
		return json({ ok: true, message: `Connected — got ${count} result(s)` });
	} catch (err) {
		return json({ ok: false, error: String(err) });
	}
};
