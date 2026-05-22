import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { races, raceUserStatus } from '$lib/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');

	const triaged = await db
		.select({
			status: raceUserStatus.status,
			notes: raceUserStatus.notes,
			updatedAt: raceUserStatus.updatedAt,
			race: races
		})
		.from(raceUserStatus)
		.innerJoin(races, eq(races.id, raceUserStatus.raceId))
		.where(eq(raceUserStatus.userId, locals.user.id))
		.orderBy(desc(raceUserStatus.updatedAt));

	return {
		triaged: triaged.map((t) => ({
			status: t.status,
			notes: t.notes,
			updatedAt: t.updatedAt.toISOString(),
			race: {
				...t.race,
				raceDate: t.race.raceDate?.toISOString() ?? null,
				firstSeenAt: t.race.firstSeenAt.toISOString()
			}
		}))
	};
};
