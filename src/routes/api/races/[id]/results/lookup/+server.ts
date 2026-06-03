import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceResults, raceDistances, raceEditions } from '$lib/server/db/schema';
import { eq, and, inArray, ilike } from 'drizzle-orm';
import { lookupBibResult, lookupNameResult, lookupAllParticipants, lookupParticipantCount } from '$lib/server/agent/results';
import type { RequestHandler } from './$types';

type BibResult = {
	position: number | null;
	name: string;
	bibNumber: string | null;
	finishTime: string;
	category: string | null;
	categoryPosition: number | null;
	club: string | null;
	distance: string | null;
};

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Login required');

	// Get all sibling distances in the same edition so lookups work across distances
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

	// A query can be a bib number (`bib=` or numeric `q=`) or a runner name (`q=`).
	const rawQuery = (url.searchParams.get('bib') ?? url.searchParams.get('q') ?? '').trim();
	const isBib = /^\d+$/.test(rawQuery);
	let bibResults: BibResult[] = [];

	if (rawQuery && isBib) {
		const bib = rawQuery;
		// Always hit the live timing provider first for fresh data
		bibResults = await lookupBibResult(params.id, bib);

		// Fall back to DB leaderboard (agent-scraped) only if live lookup found nothing
		if (bibResults.length === 0) {
			const inStored = results.find((r) => r.bibNumber?.trim() === bib);
			if (inStored) {
				bibResults = [{ ...inStored, distance: null }];
			} else {
				const siblingIds = allDistanceIds.filter((id) => id !== params.id);
				if (siblingIds.length > 0) {
					const siblingRows = await db
						.select()
						.from(raceResults)
						.where(inArray(raceResults.distanceId, siblingIds));
					const inSibling = siblingRows.find((r) => r.bibNumber?.trim() === bib);
					if (inSibling) {
						bibResults = [{ position: inSibling.position, name: inSibling.name, bibNumber: inSibling.bibNumber, finishTime: inSibling.finishTime ?? '', category: inSibling.category, categoryPosition: inSibling.categoryPosition, club: inSibling.club, distance: inSibling.distance }];
					}
				}
			}
		}
	} else if (rawQuery) {
		// Always hit the live provider first for name searches
		bibResults = await lookupNameResult(params.id, rawQuery);

		// Fall back to DB leaderboard if live provider returned nothing
		if (bibResults.length === 0) {
			const nameRows = await db
				.select()
				.from(raceResults)
				.where(and(inArray(raceResults.distanceId, allDistanceIds), ilike(raceResults.name, `%${rawQuery}%`)))
				.orderBy(raceResults.position)
				.limit(25);
			bibResults = nameRows.map((r) => ({
				position: r.position,
				name: r.name,
				bibNumber: r.bibNumber,
				finishTime: r.finishTime ?? '',
				category: r.category,
				categoryPosition: r.categoryPosition,
				club: r.club,
				distance: r.distanceId === params.id ? null : r.distance
			}));
		}
	}

	// No query and no scraped leaderboard — fetch all participants/finishers from live provider
	let allParticipants: typeof results = [];
	let participantCount: number | null = null;
	if (!rawQuery && results.length === 0) {
		const live = await lookupAllParticipants(params.id);
		participantCount = live.length;
		allParticipants = live.map(e => ({
			position: e.position,
			name: e.name,
			bibNumber: e.bibNumber,
			finishTime: e.finishTime || '—',
			category: e.category,
			categoryPosition: e.categoryPosition,
			club: e.club
		}));
	} else if (!rawQuery) {
		participantCount = results.length;
	}

	return json({ results: results.length > 0 ? results : allParticipants, bibResults, participantCount });
};


