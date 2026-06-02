import { json, error } from '@sveltejs/kit';
import { researchAndImportRace } from '$lib/server/agent/research';
import type { RequestHandler } from './$types';

/**
 * Admin "Add race by name": the admin types a race name (e.g. "Sentrumsløpet Oslo"
 * or "Tromsø Midnight Sun Marathon"). The shared research agent searches the web,
 * opens the official site / aggregator pages to gather the facts, finds a cover
 * photo, and imports the race through the shared 3-level upsert.
 */

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = (await request.json().catch(() => ({}))) as { query?: string };
	const query = (body.query ?? '').trim();
	if (!query) error(400, 'A race name is required');
	if (query.length > 200) error(400, 'Query too long');

	const log: string[] = [`🔎 Researching "${query}"…`];

	try {
		const { imported, notFoundReason } = await researchAndImportRace(
			query,
			(m) => log.push(m),
			'admin-import'
		);
		return json({ ok: !!imported, imported, notFound: notFoundReason, log });
	} catch (err) {
		log.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
		return json({ ok: false, imported: null, notFound: null, log }, { status: 500 });
	}
};
