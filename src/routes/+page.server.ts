import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, user } from '$lib/server/db/schema';
import { asc, desc, eq, sql, inArray } from 'drizzle-orm';
import { isFeatureEnabled } from '$lib/server/featureFlags';
import { haversineKm } from '$lib/server/geo';
import type { PageServerLoad } from './$types';

/** Km ranges used to match a race's distances against the user's favourite distances. */
const DISTANCE_BUCKETS: Record<string, [number, number]> = {
	'5k': [3, 7],
	'10k': [8, 14],
	half: [19, 24],
	marathon: [40, 45],
	ultra: [45, 1000]
};
const TRAIL_RE = /\b(trail|fjell|skyrace|mountain|backyard|ultra|opp|terreng)\b/i;

function matchesTargets(
	distancesKm: (number | null)[],
	eventName: string,
	targets: string[]
): boolean {
	if (targets.length === 0) return false;
	for (const t of targets) {
		if (t === 'trail') {
			if (TRAIL_RE.test(eventName)) return true;
			continue;
		}
		const range = DISTANCE_BUCKETS[t];
		if (!range) continue;
		if (distancesKm.some((km) => km != null && km >= range[0] && km <= range[1])) return true;
	}
	return false;
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id ?? null;

	const coachEnabled = userId ? await isFeatureEnabled(userId, 'ai_coach') : false;
	const coachGender = (locals.user as { gender?: string | null } | null)?.gender ?? null;

	// Full user row for personalization preferences
	const me = userId ? await db.query.user.findFirst({ where: eq(user.id, userId) }) : null;
	const homeLat = me?.homeLat ?? null;
	const homeLng = me?.homeLng ?? null;
	const travelRadiusKm = me?.travelRadiusKm ?? 150;
	const targetDistances = (me?.targetDistances as string[] | null) ?? [];
	const hasHome = homeLat != null && homeLng != null;

	const editionRows = await db
		.select({
			editionId: raceEditions.id,
			seriesId: raceSeries.id,
			eventName: raceSeries.name,
			category: raceSeries.category,
			city: raceSeries.city,
			country: raceSeries.country,
			lat: raceSeries.lat,
			lng: raceSeries.lng,
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
		// Upcoming races only (or undated), so the feed is always relevant.
		.where(sql`${raceEditions.raceDate} >= now() OR ${raceEditions.raceDate} IS NULL`)
		.orderBy(asc(raceEditions.raceDate), desc(raceEditions.firstSeenAt))
		.limit(300);

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

	const now = Date.now();
	const events = editionRows.map((e) => {
		const distances = distByEdition.get(e.editionId) ?? [];
		const distancesKm = distances.map((d) => d.distanceKm);

		const distanceFromHome =
			hasHome && e.lat != null && e.lng != null
				? Math.round(haversineKm(homeLat!, homeLng!, e.lat, e.lng))
				: null;

		const matchesTarget = matchesTargets(distancesKm, e.eventName, targetDistances);

		const daysUntil =
			e.raceDate != null
				? Math.round((e.raceDate.getTime() - now) / 86_400_000)
				: null;

		// ── Personalized relevance score ──
		let score = 0;
		// Proximity: strong boost for races inside the travel radius.
		if (distanceFromHome != null) {
			if (distanceFromHome <= travelRadiusKm) {
				score += 50 * (1 - distanceFromHome / Math.max(travelRadiusKm, 1));
			} else {
				score += Math.max(-10, 15 - (distanceFromHome - travelRadiusKm) / 80);
			}
		}
		// Favourite distance match
		if (matchesTarget) score += 25;
		// Timing
		if (daysUntil != null && daysUntil >= 0) {
			if (daysUntil <= 60) score += 15 * (1 - daysUntil / 60);
			if (e.registrationStatus === 'open') score += 10;
			if (e.registrationStatus === 'open' && daysUntil <= 45) score += 8;
		}
		// Social proof
		score += Math.min(20, Number(e.interestedCount) * 3);

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
			firstSeenAt: e.firstSeenAt.toISOString(),
			distanceFromHome,
			matchesTarget,
			score: Math.round(score * 10) / 10
		};
	});

	return {
		coachEnabled,
		coachGender,
		prefs: {
			hasHome,
			city: me?.city ?? null,
			travelRadiusKm,
			targetDistances
		},
		events
	};
};
