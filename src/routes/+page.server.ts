import { db } from '$lib/server/db';
import { races, raceUserStatus, comments } from '$lib/server/db/schema';
import { desc, eq, sql, isNull } from 'drizzle-orm';
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
		.orderBy(desc(races.firstSeenAt))
		.limit(50);

	return {
		raceItems: rows.map((r) => ({
			...r.race,
			raceDate: r.race.raceDate?.toISOString() ?? null,
			firstSeenAt: r.race.firstSeenAt.toISOString(),
			interestedCount: Number(r.interestedCount),
			commentCount: Number(r.commentCount),
			myStatus: r.myStatus ?? null
		}))
	};
};
