import { db } from '$lib/server/db';
import {
	raceSeries,
	raceEditions,
	raceDistances,
	raceUserStatus,
	raceResults,
	comments,
	user
} from '$lib/server/db/schema';import { eq, sql, and, isNull, asc, inArray } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.user?.id ?? null;

	// Load the distance plus its edition and series in one query
	const rows = await db
		.select({
			distance: raceDistances,
			edition: raceEditions,
			series: raceSeries
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceDistances.id, params.id))
		.limit(1);

	if (rows.length === 0) error(404, 'Race not found');
	const { distance, edition, series } = rows[0];

	// Sibling distances in the same edition
	const siblings = await db
		.select({
			id: raceDistances.id,
			distanceKm: raceDistances.distanceKm,
			name: raceDistances.name,
			registrationUrl: raceDistances.registrationUrl
		})
		.from(raceDistances)
		.where(and(eq(raceDistances.editionId, edition.id), sql`${raceDistances.id} != ${params.id}`))
		.orderBy(asc(raceDistances.distanceKm));

	// Results / leaderboard
	const results = await db
		.select()
		.from(raceResults)
		.where(eq(raceResults.distanceId, params.id))
		.orderBy(asc(raceResults.position))
		.limit(20);

	const interestedCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(raceUserStatus)
		.where(
			and(
				eq(raceUserStatus.editionId, edition.id),
				sql`${raceUserStatus.status} in ('interested', 'attending')`
			)
		);

	const myStatusRow = userId
		? await db.query.raceUserStatus.findFirst({
				where: and(
					eq(raceUserStatus.userId, userId),
					eq(raceUserStatus.editionId, edition.id)
				)
			})
		: null;

	const myBib = myStatusRow?.bibNumber ?? null;

	// Look up stored result for this user's bib (check this distance + siblings)
	let myResult: { position: number | null; name: string; bibNumber: string | null; finishTime: string; category: string | null; categoryPosition: number | null; club: string | null; distance: string | null } | null = null;
	if (myBib) {
		const allDistanceIds = [params.id, ...siblings.map((s) => s.id)];
		const storedRows = await db
			.select({
				position: raceResults.position,
				name: raceResults.name,
				bibNumber: raceResults.bibNumber,
				finishTime: raceResults.finishTime,
				category: raceResults.category,
				categoryPosition: raceResults.categoryPosition,
				club: raceResults.club,
				distanceKm: raceDistances.distanceKm
			})
			.from(raceResults)
			.innerJoin(raceDistances, eq(raceDistances.id, raceResults.distanceId))
			.where(and(inArray(raceResults.distanceId, allDistanceIds), eq(raceResults.bibNumber, myBib)))
			.limit(1);
		if (storedRows.length > 0) {
			const r = storedRows[0];
			myResult = {
				...r,
				distance: r.distanceKm ? `${r.distanceKm} km` : null
			};
		}
	}

	const commentRows = await db
		.select({
			id: comments.id,
			body: comments.body,
			createdAt: comments.createdAt,
			authorName: user.name,
			authorId: user.id
		})
		.from(comments)
		.innerJoin(user, eq(comments.userId, user.id))
		.where(and(eq(comments.distanceId, params.id), isNull(comments.deletedAt)))
		.orderBy(comments.createdAt);

	return {
		race: {
			id: distance.id,
			name: distance.name,
			eventName: series.name,
			distanceKm: distance.distanceKm,
			medalStatus: distance.medalStatus,
			registrationUrl: distance.registrationUrl,
			resultsUrl: distance.resultsUrl,
			// Edition-level fields
			raceDate: edition.raceDate?.toISOString() ?? null,
			location: edition.location,
			registrationStatus: edition.registrationStatus,
			websiteUrl: edition.websiteUrl ?? series.websiteUrl,
			// Series-level fields
			category: series.category,
			city: series.city,
			country: series.country,
			imageUrl: series.imageUrl,
			whyItFits: series.whyItFits,
			// Meta
			firstSeenAt: distance.firstSeenAt.toISOString(),
			lastUpdatedAt: distance.lastUpdatedAt.toISOString(),
			// IDs for navigation
			editionId: edition.id,
			seriesId: series.id
		},
		siblings: siblings.map((s) => ({
			id: s.id,
			distanceKm: s.distanceKm,
			name: s.name,
			registrationUrl: s.registrationUrl
		})),
		results: results.map((r) => ({
			position: r.position,
			name: r.name,
			bibNumber: r.bibNumber,
			finishTime: r.finishTime,
			category: r.category,
			categoryPosition: r.categoryPosition,
			club: r.club
		})),
		interestedCount: Number(interestedCount[0].count),
		myStatus: myStatusRow?.status ?? null,
		myBib,
		myResult,
		myNotes: myStatusRow?.notes ?? null,
		comments: commentRows.map((c) => ({
			...c,
			createdAt: c.createdAt.toISOString()
		}))
	};
};
