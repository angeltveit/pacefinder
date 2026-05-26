import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceResults, raceDistances, raceEditions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { lookupBibResult } from '$lib/server/agent/results';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Login required');

	// Get all sibling distances in the same edition so bib lookup works across distances
	const thisDistance = await db.query.raceDistances.findFirst({ where: eq(raceDistances.id, params.id) });
	const allDistanceIds: string[] = thisDistance
		? (await db.select({ id: raceDistances.id })
				.from(raceDistances)
				.where(eq(raceDistances.editionId, thisDistance.editionId)))
				.map((d) => d.id)
		: [params.id];

	const rows = await db
		.select()
		.from(raceResults)
		.where(eq(raceResults.distanceId, params.id))
		.orderBy(raceResults.position);

	const results = rows.map((r) => ({
		position: r.position,
		name: r.name,
		bibNumber: r.bibNumber,
		finishTime: r.finishTime,
		category: r.category,
		categoryPosition: r.categoryPosition,
		club: r.club
	}));

	const bib = url.searchParams.get('bib')?.trim();
	let bibResults: { position: number | null; name: string; bibNumber: string | null; finishTime: string; category: string | null; categoryPosition: number | null; club: string | null; distance: string | null }[] = [];
	if (bib) {
		// Check stored results for this distance first, then siblings
		const inStored = results.find((r) => r.bibNumber?.trim() === bib);
		if (inStored) {
			bibResults = [{ ...inStored, distance: null }];
		} else {
			// Try siblings in DB before doing a live timing provider lookup
			const siblingIds = allDistanceIds.filter((id) => id !== params.id);
			if (siblingIds.length > 0) {
				const { inArray } = await import('drizzle-orm');
				const siblingRows = await db
					.select()
					.from(raceResults)
					.where(inArray(raceResults.distanceId, siblingIds));
				const inSibling = siblingRows.find((r) => r.bibNumber?.trim() === bib);
				if (inSibling) {
					bibResults = [{ position: inSibling.position, name: inSibling.name, bibNumber: inSibling.bibNumber, finishTime: inSibling.finishTime ?? '', category: inSibling.category, categoryPosition: inSibling.categoryPosition, club: inSibling.club, distance: inSibling.distance }];
				}
			}
			if (bibResults.length === 0) {
				bibResults = await lookupBibResult(params.id, bib);
				// Persist live results so future loads don't need a re-fetch
				if (bibResults.length > 0) {
					const { distance: _dist, ...r } = bibResults[0];
					const already = await db.query.raceResults.findFirst({
						where: and(eq(raceResults.distanceId, params.id), eq(raceResults.bibNumber, bib))
					});
					if (!already) {
						await db.insert(raceResults).values({
							distanceId: params.id,
							position: r.position,
							name: r.name,
							bibNumber: r.bibNumber,
							finishTime: r.finishTime,
							category: r.category,
							categoryPosition: r.categoryPosition,
							club: r.club
						});
					}
				}
			}
		}
	}

	return json({ results, bibResults });
};

