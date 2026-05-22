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
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
	const pageSize = 20;

	const conditions = [];
	if (category) conditions.push(eq(races.category, category));
	if (medal) conditions.push(eq(races.medalStatus, medal));
	if (regStatus) conditions.push(eq(races.registrationStatus, regStatus));

	// If filtering by myStatus, we need to join
	const baseQuery = db
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
		);

	const allConditions =
		myStatus && userId
			? [...conditions, eq(raceUserStatus.status, myStatus)]
			: conditions;

	const rows = await baseQuery
		.where(allConditions.length ? and(...allConditions) : undefined)
		.orderBy(desc(races.firstSeenAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize);

	const [countRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(races)
		.where(conditions.length ? and(...conditions) : undefined);

	return {
		raceItems: rows.map((r) => ({
			...r.race,
			raceDate: r.race.raceDate?.toISOString() ?? null,
			firstSeenAt: r.race.firstSeenAt.toISOString(),
			interestedCount: Number(r.interestedCount),
			commentCount: Number(r.commentCount),
			myStatus: r.myStatus ?? null
		})),
		total: Number(countRow.count),
		page,
		pageSize,
		filters: { category, medal, regStatus, myStatus }
	};
};
