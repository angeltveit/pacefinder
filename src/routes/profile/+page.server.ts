import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceUserStatus } from '$lib/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');

	const triaged = await db
		.select({
			status: raceUserStatus.status,
			notes: raceUserStatus.notes,
			updatedAt: raceUserStatus.updatedAt,
			// Link to the first (lowest km) distance in the edition
			raceId: sql<string>`(select id from race_distances where edition_id = ${raceEditions.id} order by distance_km asc nulls last limit 1)`,
			eventName: raceSeries.name,
			city: raceSeries.city,
			country: raceSeries.country,
			category: raceSeries.category,
			raceDate: raceEditions.raceDate,
			registrationStatus: raceEditions.registrationStatus,
			websiteUrl: sql<string | null>`coalesce(${raceEditions.websiteUrl}, ${raceSeries.websiteUrl})`,
			firstSeenAt: raceEditions.firstSeenAt
		})
		.from(raceUserStatus)
		.innerJoin(raceEditions, eq(raceEditions.id, raceUserStatus.editionId))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceUserStatus.userId, locals.user.id))
		.orderBy(desc(raceUserStatus.updatedAt));

	return {
		triaged: triaged.map((t) => ({
			status: t.status,
			notes: t.notes,
			updatedAt: t.updatedAt.toISOString(),
			race: {
				id: t.raceId,
				name: t.eventName,
				eventName: t.eventName,
				distanceKm: null,
				city: t.city,
				country: t.country,
				category: t.category,
				raceDate: t.raceDate?.toISOString() ?? null,
				medalStatus: null,
				registrationStatus: t.registrationStatus,
				websiteUrl: t.websiteUrl,
				firstSeenAt: t.firstSeenAt.toISOString()
			}
		}))
	};
};
