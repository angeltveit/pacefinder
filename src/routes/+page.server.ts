import { db } from '$lib/server/db';
import { races, raceUserStatus, comments } from '$lib/server/db/schema';
import { asc, desc, eq, sql, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id ?? null;

	// Get races added in the last 7 days, newest first
	const rows = await db
		.select({
			race: races,
			myStatus: raceUserStatus.status,
			interestedCount: sql<number>`(
				select count(*) from race_user_status
				where race_id = ${races.id} and status = 'interested'
			)`.as('interested_count'),
			commentCount: sql<number>`(
				select count(*) from comments
				where race_id = ${races.id} and deleted_at is null
			)`.as('comment_count')
		})
		.from(races)
		.leftJoin(
			raceUserStatus,
			userId
				? sql`${raceUserStatus.raceId} = ${races.id} and ${raceUserStatus.userId} = ${userId}`
				: sql`false`
		)
		.where(sql`${races.firstSeenAt} >= now() - interval '7 days'`)
		.orderBy(asc(races.raceDate), desc(races.firstSeenAt))
		.limit(100);

	// Group races by event_name
	const eventMap = new Map<string, {
		eventName: string;
		category: string;
		city: string;
		country: string;
		raceDate: string | null;
		medalStatus: string;
		registrationStatus: string;
		websiteUrl: string | null;
		imageUrl: string | null;
		whyItFits: string | null;
		interestedCount: number;
		commentCount: number;
		myStatus: string | null;
		distances: { id: string; distanceKm: number | null; registrationUrl: string | null }[];
		firstSeenAt: string;
		primaryId: string;
	}>();

	for (const r of rows) {
		const key = r.race.eventName ?? r.race.name;
		const existing = eventMap.get(key);
		const distance = {
			id: r.race.id,
			distanceKm: r.race.distanceKm,
			registrationUrl: r.race.registrationUrl
		};

		if (existing) {
			existing.distances.push(distance);
			existing.interestedCount += Number(r.interestedCount);
			existing.commentCount += Number(r.commentCount);
			// Keep best data
			if (!existing.imageUrl && r.race.imageUrl) existing.imageUrl = r.race.imageUrl;
			if (!existing.websiteUrl && r.race.websiteUrl) existing.websiteUrl = r.race.websiteUrl;
			if (!existing.raceDate && r.race.raceDate) existing.raceDate = r.race.raceDate.toISOString();
			if (r.race.medalStatus === 'confirmed') existing.medalStatus = 'confirmed';
			else if (r.race.medalStatus === 'likely' && existing.medalStatus !== 'confirmed') existing.medalStatus = 'likely';
			if (r.myStatus === 'interested') existing.myStatus = 'interested';
		} else {
			eventMap.set(key, {
				eventName: key,
				category: r.race.category,
				city: r.race.city,
				country: r.race.country,
				raceDate: r.race.raceDate?.toISOString() ?? null,
				medalStatus: r.race.medalStatus,
				registrationStatus: r.race.registrationStatus,
				websiteUrl: r.race.websiteUrl,
				imageUrl: r.race.imageUrl,
				whyItFits: r.race.whyItFits,
				interestedCount: Number(r.interestedCount),
				commentCount: Number(r.commentCount),
				myStatus: r.myStatus ?? null,
				distances: [distance],
				firstSeenAt: r.race.firstSeenAt.toISOString(),
				primaryId: r.race.id
			});
		}
	}

	return {
		events: [...eventMap.values()].map(e => ({
			...e,
			distances: e.distances.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
		}))
	};
};
