import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances, agentRuns, user, comments, settings } from '$lib/server/db/schema';
import { desc, eq, sql, gt, gte, and, isNull } from 'drizzle-orm';
import { getHash, getStat, pingRedis, KEYS } from '$lib/server/redis';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const now = new Date();
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

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
		topCommented,
		monthlySpendRow,
		budgetRow
	] = await Promise.all([
		db.select({ count: sql<number>`count(*)` }).from(user),
		db.select({ count: sql<number>`count(*)` }).from(user).where(gt(user.createdAt, yesterday)),
		db.select({ count: sql<number>`count(*)` }).from(raceDistances),
		db
			.select({ count: sql<number>`count(*)` })
			.from(raceEditions)
			.where(gt(raceEditions.raceDate, now)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(raceDistances)
			.where(gt(raceDistances.firstSeenAt, yesterday)),
		db.select({ count: sql<number>`count(*)` }).from(comments).where(sql`deleted_at is null`),
		db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(10),
		db
			.select({
				id: raceEditions.id,
				name: raceSeries.name,
				count: sql<number>`(select count(*) from race_user_status where edition_id = ${raceEditions.id} and status = 'interested')`
			})
			.from(raceEditions)
			.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
			.orderBy(sql`count desc`)
			.limit(5),
		db
			.select({
				id: raceDistances.id,
				name: sql<string>`${raceSeries.name} || ' – ' || ${raceDistances.name}`,
				count: sql<number>`(select count(*) from comments where distance_id = ${raceDistances.id} and deleted_at is null)`
			})
			.from(raceDistances)
			.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
			.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
			.orderBy(sql`count desc`)
			.limit(5),
		db
			.select({ spend: sql<number>`coalesce(sum(${agentRuns.estimatedCostUsd}), 0)` })
			.from(agentRuns)
			.where(gte(agentRuns.startedAt, startOfMonth)),
		db.query.settings.findFirst({
			where: and(
				eq(settings.scope, 'system'),
				eq(settings.key, 'llm_monthly_budget_usd'),
				isNull(settings.userId)
			)
		})
	]);

	// Redis stats (may be null if Redis unavailable)
	const [redisAvailable, redisLastRun, costAlltime, costToday, tokensInToday, tokensOutToday] = await Promise.all([
		pingRedis(),
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
			available: redisAvailable,
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
		topCommented,
		budget: {
			monthlySpend: Number(monthlySpendRow[0].spend),
			monthlyBudget: budgetRow
				? parseFloat(budgetRow.value)
				: parseFloat(env.MONTHLY_LLM_BUDGET_USD ?? '10')
		}
	};
};
