import { error } from '@sveltejs/kit';
import { runAgent, ALL_SOURCES, type SourceId } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	let enabledSources: SourceId[] | undefined;
	try {
		const body = await request.json();
		if (Array.isArray(body.sources)) {
			enabledSources = body.sources.filter((s: string) =>
				(ALL_SOURCES as readonly string[]).includes(s)
			) as SourceId[];
		}
	} catch {
		// No body or invalid JSON — use all sources
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

			try {
				const { racesNew, racesUpdated } = await runAgent(
					(msg) => send({ type: 'log', message: msg }),
					enabledSources
				);
				send({ type: 'done', racesNew, racesUpdated });
			} catch (err) {
				send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
