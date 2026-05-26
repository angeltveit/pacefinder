import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, raceUserStatus } from '$lib/server/db/schema';
import { asc, desc, eq, sql, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id ?? null;

	const editionRows = await db
		.select({
			editionId: raceEditions.id,
			seriesId: raceSeries.id,
			eventName: raceSeries.name,
			category: raceSeries.category,
			city: raceSeries.city,
			country: raceSeries.country,
			imageUrl: raceSeries.imageUrl,
			whyItFits: raceSeries.whyItFits,
			raceDate: raceEditions.raceDate,
			registrationStatus: raceEditions.registrationStatus,
			websiteUrl: sql<string | null>`coalesce(${raceEditions.websiteUrl}, ${raceSeries.websiteUrl})`,
			firstSeenAt: raceEditions.firstSeenAt,
			interestedCount: sql<number>`(
				select count(*) from race_user_status rus
				where rus.edition_id = ${raceEditions.id}
				and rus.status in ('interested', 'attending')
			)`.as('interested_count'),
			commentCount: sql<number>`(
				select count(*) from comments c
				join race_distances rd on rd.id = c.distance_id
				where rd.edition_id = ${raceEditions.id}
				and c.deleted_at is null
			)`.as('comment_count'),
			medalStatus: sql<string>`(
				select case
					when bool_or(medal_status = 'confirmed') then 'confirmed'
					when bool_or(medal_status = 'likely') then 'likely'
					else 'unclear'
				end from race_distances where edition_id = ${raceEditions.id}
			)`.as('medal_status'),
			myStatus: userId
				? sql<string | null>`(
					select rus.status from race_user_status rus
					where rus.edition_id = ${raceEditions.id}
					and rus.user_id = ${userId}
					and rus.status in ('interested', 'attending')
					limit 1
				)`.as('my_status')
				: sql<null>`null`.as('my_status')
		})
		.from(raceEditions)
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(sql`${raceEditions.firstSeenAt} >= now() - interval '7 days'`)
		.orderBy(asc(raceEditions.raceDate), desc(raceEditions.firstSeenAt))
		.limit(100);

	const editionIds = editionRows.map((r) => r.editionId);
	const distanceRows =
		editionIds.length > 0
			? await db
					.select({
						editionId: raceDistances.editionId,
						id: raceDistances.id,
						distanceKm: raceDistances.distanceKm,
						registrationUrl: raceDistances.registrationUrl
					})
					.from(raceDistances)
					.where(inArray(raceDistances.editionId, editionIds))
					.orderBy(asc(raceDistances.distanceKm))
			: [];

	const distByEdition = new Map<string, typeof distanceRows>();
	for (const d of distanceRows) {
		const key = d.editionId!;
		if (!distByEdition.has(key)) distByEdition.set(key, []);
		distByEdition.get(key)!.push(d);
	}

	return {
		events: editionRows.map((e) => {
			const distances = distByEdition.get(e.editionId) ?? [];
			return {
				editionId: e.editionId,
				seriesId: e.seriesId,
				eventName: e.eventName,
				category: e.category,
				city: e.city,
				country: e.country,
				imageUrl: e.imageUrl,
				whyItFits: e.whyItFits,
				raceDate: e.raceDate?.toISOString() ?? null,
				registrationStatus: e.registrationStatus,
				websiteUrl: e.websiteUrl,
				medalStatus: e.medalStatus,
				interestedCount: Number(e.interestedCount),
				commentCount: Number(e.commentCount),
				myStatus: e.myStatus ?? null,
				distances: distances.map((d) => ({
					id: d.id,
					distanceKm: d.distanceKm,
					registrationUrl: d.registrationUrl
				})),
				primaryId: distances[0]?.id ?? e.editionId,
				firstSeenAt: e.firstSeenAt.toISOString()
			};
		})
	};
};
