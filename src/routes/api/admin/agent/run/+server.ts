import { error } from '@sveltejs/kit';
import { runAgent } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

			try {
				const { racesNew, racesUpdated } = await runAgent((msg) =>
					send({ type: 'log', message: msg })
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
