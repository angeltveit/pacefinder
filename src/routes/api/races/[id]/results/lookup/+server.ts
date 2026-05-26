import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceResults } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { lookupBibResult } from '$lib/server/agent/results';
import type { RequestHandler } from './$types';

/** Lightweight GET endpoint — returns current DB results for a race (no scraping).
 *  If ?bib=N is provided, also performs a bib-specific lookup against the timing
 *  provider when the bib is not already in the stored results. */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Login required');

	const rows = await db
		.select()
		.from(raceResults)
		.where(eq(raceResults.raceId, params.id))
		.orderBy(raceResults.position);

	const results = rows.map(r => ({
		position: r.position,
		name: r.name,
		bibNumber: r.bibNumber,
		finishTime: r.finishTime,
		category: r.category,
		categoryPosition: r.categoryPosition,
		club: r.club
	}));

	// If a specific bib is requested, look it up across all distances
	const bib = url.searchParams.get('bib')?.trim();
	let bibResults: { position: number | null; name: string; bibNumber: string | null; finishTime: string; category: string | null; categoryPosition: number | null; club: string | null; distance: string | null }[] = [];
	if (bib) {
		// Check if already in stored results
		const inStored = results.find(r => r.bibNumber?.trim() === bib);
		if (inStored) {
			bibResults = [{ ...inStored, distance: null }];
		} else {
			bibResults = await lookupBibResult(params.id, bib);
		}
	}

	return json({ results, bibResults });
};
