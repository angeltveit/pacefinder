/**
 * POST /api/admin/races/geocode-all
 * Backfills lat/lng on every race_series row that currently has no coordinates.
 * Streams SSE log lines so the admin UI can show progress.
 */
import { db } from '$lib/server/db';
import { raceSeries } from '$lib/server/db/schema';
import { forwardGeocode } from '$lib/server/geo';
import { isNull, or } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const encoder = new TextDecoder();
	const stream = new ReadableStream({
		async start(controller) {
			function send(type: string, payload: Record<string, unknown>) {
				controller.enqueue(
					new TextEncoder().encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
				);
			}
			function log(message: string) {
				send('log', { message });
			}

			try {
				// Fetch all series that are missing coordinates.
				const missing = await db
					.select({
						id: raceSeries.id,
						city: raceSeries.city,
						country: raceSeries.country
					})
					.from(raceSeries)
					.where(or(isNull(raceSeries.lat), isNull(raceSeries.lng)));

				log(`Found ${missing.length} series without coordinates`);

				let updated = 0;
				let failed = 0;

				for (const series of missing) {
					const query = series.country
						? `${series.city}, ${series.country}`
						: series.city;
					const geo = await forwardGeocode(query);
					if (geo) {
						await db
							.update(raceSeries)
							.set({ lat: geo.lat, lng: geo.lng })
							.where(eq(raceSeries.id, series.id));
						updated++;
						log(`✓ ${query} → ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`);
					} else {
						failed++;
						log(`✗ Could not geocode "${query}"`);
					}
					// Nominatim asks for ≤1 req/s — respect that.
					await new Promise((r) => setTimeout(r, 1100));
				}

				send('done', { updated, failed });
			} catch (err) {
				send('error', { error: err instanceof Error ? err.message : String(err) });
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
