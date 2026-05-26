import { error } from '@sveltejs/kit';
import * as cheerio from 'cheerio';
import { db } from '$lib/server/db';
import { races } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { classifyRaces } from '$lib/server/agent/classifier';
import { enrichRaces } from '$lib/server/agent/enrichment';
import type { RawRaceLead } from '$lib/server/agent/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'admin') error(403, 'Forbidden');

	const body = await request.json().catch(() => null);
	const url: string = body?.url?.trim();
	if (!url || !/^https?:\/\//i.test(url)) error(400, 'Invalid URL');

	const stream = new ReadableStream({
		async start(controller) {
			const enc = new TextEncoder();
			function send(type: string, payload: Record<string, unknown>) {
				controller.enqueue(enc.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
			}
			function log(message: string) { send('log', { message }); }

			try {
				// Fetch and parse the page
				log(`Fetching ${url}…`);
				const res = await fetch(url, {
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)',
						Accept: 'text/html,application/xhtml+xml'
					},
					redirect: 'follow',
					signal: AbortSignal.timeout(15_000)
				});

				if (!res.ok) {
					send('error', { error: `HTTP ${res.status} fetching URL` });
					controller.close();
					return;
				}

				const html = await res.text();
				const $ = cheerio.load(html);
				const title = $('title').text().trim();
				const metaDesc = $('meta[name="description"]').attr('content')
					?? $('meta[property="og:description"]').attr('content') ?? '';
				$('script, style, nav, footer, aside, noscript').remove();
				const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

				log(`Page title: "${title}"`);

				const lead: RawRaceLead = {
					name: title || url,
					url,
					source: 'manual-url',
					description: metaDesc,
					rawText: bodyText
				};

				// Classify
				log('Classifying with LLM…');
				const { classified, tokensIn, tokensOut, costUsd } = await classifyRaces([lead]);
				log(`LLM found ${classified.length} race(s) (${tokensIn + tokensOut} tokens, $${costUsd.toFixed(4)})`);

				if (classified.length === 0) {
					send('done', { racesNew: 0, racesUpdated: 0, message: 'No qualifying races found on that page.' });
					controller.close();
					return;
				}

				// Enrich
				const enriched = await enrichRaces(classified, log);

				// Upsert
				log('Saving to database…');
				let racesNew = 0;
				let racesUpdated = 0;

				for (const race of enriched) {
					const existing = await db.query.races.findFirst({
						where: eq(races.fingerprint, race.fingerprint)
					});

					if (!existing) {
						await db.insert(races).values(race);
						racesNew++;
						log(`  ✓ Added: ${race.name} (${race.city})`);
					} else {
						await db.update(races).set({
							registrationStatus: race.registrationStatus,
							registrationUrl: race.registrationUrl ?? existing.registrationUrl,
							resultsUrl: race.resultsUrl ?? existing.resultsUrl,
							medalStatus: race.medalStatus,
							websiteUrl: race.websiteUrl ?? existing.websiteUrl,
							imageUrl: race.imageUrl ?? existing.imageUrl,
							raceDate: race.raceDate ?? existing.raceDate,
							eventName: race.eventName ?? existing.eventName,
							lastUpdatedAt: new Date()
						}).where(eq(races.fingerprint, race.fingerprint));
						racesUpdated++;
						log(`  ↻ Updated: ${race.name} (already existed)`);
					}
				}

				// Propagate medal confirmations across sibling distances
				await db.execute(sql`
					UPDATE races SET medal_status = 'confirmed', last_updated_at = now()
					WHERE medal_status != 'confirmed'
					AND EXISTS (
						SELECT 1 FROM races r2
						WHERE r2.medal_status = 'confirmed' AND r2.id != races.id
						AND split_part(races.name, ' – ', 1) = split_part(r2.name, ' – ', 1)
					)
				`);

				send('done', { racesNew, racesUpdated });
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
