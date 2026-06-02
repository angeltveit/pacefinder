import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, raceUserStatus } from '$lib/server/db/schema';
import { asc, desc, eq, sql, inArray, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const FOLLOWED_STATUSES = ['interested', 'attending', 'following'];

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const userId = locals.user.id;

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
			myStatus: raceUserStatus.status,
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
			)`.as('medal_status')
		})
		.from(raceUserStatus)
		.innerJoin(raceEditions, eq(raceEditions.id, raceUserStatus.editionId))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(
			and(
				eq(raceUserStatus.userId, userId),
				inArray(raceUserStatus.status, FOLLOWED_STATUSES)
			)
		)
		.orderBy(asc(raceEditions.raceDate), desc(raceEditions.firstSeenAt));

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

	const events = editionRows.map((e) => {
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
	});

	// Split into upcoming (today or future / undated) and past, by race date.
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);
	const cutoff = startOfToday.getTime();

	const upcoming = events
		.filter((e) => !e.raceDate || new Date(e.raceDate).getTime() >= cutoff)
		.sort((a, b) => {
			const ta = a.raceDate ? new Date(a.raceDate).getTime() : Infinity;
			const tb = b.raceDate ? new Date(b.raceDate).getTime() : Infinity;
			return ta - tb;
		});

	const past = events
		.filter((e) => e.raceDate && new Date(e.raceDate).getTime() < cutoff)
		.sort((a, b) => new Date(b.raceDate!).getTime() - new Date(a.raceDate!).getTime());

	return { upcoming, past };
};
