import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	if (!env.GOOGLE_CSE_ID || !env.GOOGLE_CSE_API_KEY) {
		return json({ ok: false, error: 'GOOGLE_CSE_ID or GOOGLE_CSE_API_KEY is not set' });
	}

	try {
		const url = new URL('https://www.googleapis.com/customsearch/v1');
		url.searchParams.set('key', env.GOOGLE_CSE_API_KEY);
		url.searchParams.set('cx', env.GOOGLE_CSE_ID);
		url.searchParams.set('q', 'running race Bergen 2026');
		url.searchParams.set('num', '1');

		const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const msg = data?.error?.message ?? `HTTP ${res.status}`;
			return json({ ok: false, error: msg });
		}

		const data = await res.json();
		const count = data.items?.length ?? 0;
		const total = data.searchInformation?.totalResults ?? '?';
		return json({ ok: true, message: `Connected — ${count} result(s), ~${total} total` });
	} catch (err) {
		return json({ ok: false, error: String(err) });
	}
};
