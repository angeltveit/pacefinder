import { db } from '$lib/server/db';
import { races, raceUserStatus, comments, user } from '$lib/server/db/schema';
import { eq, sql, and, isNull, ne } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.user?.id ?? null;

	const race = await db.query.races.findFirst({ where: eq(races.id, params.id) });
	if (!race) error(404, 'Race not found');

	// Find sibling distances for same event
	const siblings = race.eventName
		? await db
				.select({ id: races.id, distanceKm: races.distanceKm, name: races.name, registrationUrl: races.registrationUrl })
				.from(races)
				.where(and(eq(races.eventName, race.eventName), ne(races.id, race.id)))
		: [];

	const interestedCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(raceUserStatus)
		.where(and(eq(raceUserStatus.raceId, params.id), eq(raceUserStatus.status, 'interested')));

	const myStatusRow = userId
		? await db.query.raceUserStatus.findFirst({
				where: and(eq(raceUserStatus.userId, userId), eq(raceUserStatus.raceId, params.id))
			})
		: null;

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
		.where(and(eq(comments.raceId, params.id), isNull(comments.deletedAt)))
		.orderBy(comments.createdAt);

	return {
		race: {
			...race,
			raceDate: race.raceDate?.toISOString() ?? null,
			firstSeenAt: race.firstSeenAt.toISOString(),
			lastUpdatedAt: race.lastUpdatedAt.toISOString()
		},
		siblings: siblings
			.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
			.map(s => ({ id: s.id, distanceKm: s.distanceKm, name: s.name, registrationUrl: s.registrationUrl })),
		interestedCount: Number(interestedCount[0].count),
		myStatus: myStatusRow?.status ?? null,
		myNotes: myStatusRow?.notes ?? null,
		comments: commentRows.map((c) => ({
			...c,
			createdAt: c.createdAt.toISOString()
		}))
	};
};
