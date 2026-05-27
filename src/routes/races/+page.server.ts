import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, raceUserStatus } from '$lib/server/db/schema';
import { desc, eq, sql, and, inArray, asc, gte, lt, ilike, or } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id ?? null;
	const q = url.searchParams.get('q') ?? '';
	const category = url.searchParams.get('category') ?? '';
	const time = url.searchParams.get('time') ?? 'upcoming';
	const medal = url.searchParams.get('medal') ?? '';
	const regStatus = url.searchParams.get('reg') ?? '';
	const myStatus = url.searchParams.get('mine') ?? '';

	const conditions = [];

	// Text search
	if (q) {
		const pattern = `%${q}%`;
		conditions.push(or(
			ilike(raceSeries.name, pattern),
			ilike(raceSeries.city, pattern),
			ilike(raceSeries.country, pattern)
		)!);
	}

	// Category: 'local' = same country as user, 'travel' = different country
	const userCountry = locals.user?.country ?? 'NO';
	if (category === 'local') conditions.push(eq(raceSeries.country, userCountry));
	else if (category === 'travel') conditions.push(
		sql`${raceSeries.country} != ${userCountry}`
	);

	// Time filter
	const now = new Date();
	if (time === 'upcoming') conditions.push(
		or(gte(raceEditions.raceDate, now), sql`${raceEditions.raceDate} IS NULL`)!
	);
	else if (time === 'past') conditions.push(lt(raceEditions.raceDate, now));

	if (regStatus) conditions.push(eq(raceEditions.registrationStatus, regStatus));
	if (medal) conditions.push(
		sql`EXISTS (SELECT 1 FROM race_distances WHERE edition_id = ${raceEditions.id} AND medal_status = ${medal})`
	);
	if (myStatus && userId) conditions.push(
		sql`EXISTS (
			SELECT 1 FROM race_user_status rus
			WHERE rus.edition_id = ${raceEditions.id}
			AND rus.user_id = ${userId}
			AND rus.status = ${myStatus}
		)`
	);

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
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(
			// User's country first, then by date
			sql`CASE WHEN ${raceSeries.country} = ${userCountry} THEN 0 ELSE 1 END`,
			time === 'past'
				? desc(raceEditions.raceDate)
				: asc(raceEditions.raceDate)
		)
		.limit(200);

	// Fetch distances for all returned editions in one query
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

	return {
		events,
		total: events.length,
		filters: { q, category, time, medal, regStatus, myStatus }
	};
};
