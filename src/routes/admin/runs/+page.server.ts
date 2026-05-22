import { db } from '$lib/server/db';
import { agentRuns } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(50);
	return {
		runs: runs.map((r) => ({
			...r,
			startedAt: r.startedAt.toISOString(),
			finishedAt: r.finishedAt?.toISOString() ?? null
		}))
	};
};
