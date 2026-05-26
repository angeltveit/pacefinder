import { json, error } from '@sveltejs/kit';
import { fetchResultsForRace } from '$lib/server/agent/results';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const log: string[] = [];
	const onLog = (msg: string) => log.push(msg);

	const success = await fetchResultsForRace(params.id, onLog);

	return json({ ok: success, log });
};
