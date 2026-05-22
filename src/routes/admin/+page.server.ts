import { db } from '$lib/server/db';
import { races, agentRuns, user, comments } from '$lib/server/db/schema';
import { desc, eq, sql, gt } from 'drizzle-orm';
import { getHash, getStat, KEYS } from '$lib/server/redis';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const now = new Date();
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

	// DB queries in parallel
	const [
		totalUsersRow,
		newUsersRow,
		totalRacesRow,
		upcomingRacesRow,
		newRacesRow,
		totalCommentsRow,
		lastRuns,
		topInterested,
		topCommented
	] = await Promise.all([
		db.select({ count: sql<number>`count(*)` }).from(user),
		db.select({ count: sql<number>`count(*)` }).from(user).where(gt(user.createdAt, yesterday)),
		db.select({ count: sql<number>`count(*)` }).from(races),
		db
			.select({ count: sql<number>`count(*)` })
			.from(races)
			.where(gt(races.raceDate, now)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(races)
			.where(gt(races.firstSeenAt, yesterday)),
		db.select({ count: sql<number>`count(*)` }).from(comments).where(sql`deleted_at is null`),
		db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(10),
		db
			.select({
				id: races.id,
				name: races.name,
				count: sql<number>`(select count(*) from race_user_status where race_id = ${races.id} and status = 'interested')`
			})
			.from(races)
			.orderBy(sql`count desc`)
			.limit(5),
		db
			.select({
				id: races.id,
				name: races.name,
				count: sql<number>`(select count(*) from comments where race_id = ${races.id} and deleted_at is null)`
			})
			.from(races)
			.orderBy(sql`count desc`)
			.limit(5)
	]);

	// Redis stats (may be null if Redis unavailable)
	const [redisLastRun, costAlltime, costToday, tokensInToday, tokensOutToday] = await Promise.all([
		getHash(KEYS.AGENT_LAST_RUN),
		getStat(KEYS.TOKENS_COST_ALLTIME),
		getStat(KEYS.TOKENS_COST_TODAY),
		getStat(KEYS.TOKENS_INPUT_TODAY),
		getStat(KEYS.TOKENS_OUTPUT_TODAY)
	]);

	return {
		stats: {
			totalUsers: Number(totalUsersRow[0].count),
			newUsers24h: Number(newUsersRow[0].count),
			totalRaces: Number(totalRacesRow[0].count),
			upcomingRaces: Number(upcomingRacesRow[0].count),
			newRaces24h: Number(newRacesRow[0].count),
			totalComments: Number(totalCommentsRow[0].count)
		},
		redis: {
			available: !!redisLastRun,
			costAlltime: costAlltime ? Number(costAlltime).toFixed(4) : null,
			costToday: costToday ? Number(costToday).toFixed(4) : null,
			tokensInToday: tokensInToday ? Number(tokensInToday) : null,
			tokensOutToday: tokensOutToday ? Number(tokensOutToday) : null
		},
		lastRuns: lastRuns.map((r) => ({
			...r,
			startedAt: r.startedAt.toISOString(),
			finishedAt: r.finishedAt?.toISOString() ?? null
		})),
		topInterested,
		topCommented
	};
};
