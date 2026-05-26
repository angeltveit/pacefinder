import { db } from '$lib/server/db';
import { races, raceUserStatus } from '$lib/server/db/schema';
import { desc, eq, sql, and, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id ?? null;
	const category = url.searchParams.get('category') ?? '';
	const medal = url.searchParams.get('medal') ?? '';
	const regStatus = url.searchParams.get('reg') ?? '';
	const myStatus = url.searchParams.get('mine') ?? '';

	const conditions = [];
	if (category) conditions.push(eq(races.category, category));
	if (medal) conditions.push(eq(races.medalStatus, medal));
	if (regStatus) conditions.push(eq(races.registrationStatus, regStatus));

	const baseQuery = db
		.select({
			race: races,
			myStatus: raceUserStatus.status,
			interestedCount: sql<number>`(
				select count(*) from race_user_status
				where race_id = ${races.id} and status in ('interested', 'attending')
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
		);

	const allConditions =
		myStatus && userId
			? [...conditions, eq(raceUserStatus.status, myStatus)]
			: conditions;

	const rows = await baseQuery
		.where(allConditions.length ? and(...allConditions) : undefined)
		.orderBy(desc(races.firstSeenAt))
		.limit(200);

	// Group by event_name
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
		const distance = {
			id: r.race.id,
			distanceKm: r.race.distanceKm,
			registrationUrl: r.race.registrationUrl
		};
		const existing = eventMap.get(key);

		if (existing) {
			existing.distances.push(distance);
			existing.interestedCount += Number(r.interestedCount);
			existing.commentCount += Number(r.commentCount);
			if (!existing.imageUrl && r.race.imageUrl) existing.imageUrl = r.race.imageUrl;
			if (!existing.websiteUrl && r.race.websiteUrl) existing.websiteUrl = r.race.websiteUrl;
			if (!existing.raceDate && r.race.raceDate) existing.raceDate = r.race.raceDate.toISOString();
			if (r.race.medalStatus === 'confirmed') existing.medalStatus = 'confirmed';
			else if (r.race.medalStatus === 'likely' && existing.medalStatus !== 'confirmed') existing.medalStatus = 'likely';
			if (r.myStatus === 'interested' || r.myStatus === 'attending') existing.myStatus = r.myStatus;
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

	const events = [...eventMap.values()].map(e => ({
		...e,
		distances: e.distances.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
	}));

	return {
		events,
		total: events.length,
		filters: { category, medal, regStatus, myStatus }
	};
};
