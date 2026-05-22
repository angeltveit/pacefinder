import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runAgent } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const secret = request.headers.get('x-agent-secret');
	if (!env.AGENT_SECRET || secret !== env.AGENT_SECRET) {
		error(401, 'Unauthorized');
	}

	try {
		const result = await runAgent();
		return json({ ok: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ ok: false, error: message }, { status: 500 });
	}
};
