import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceDistances, raceUserStatus } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const schema = z.object({
	status: z.enum(['interested', 'attending', 'following', 'seen', 'skip']).nullable(),
	bibNumber: z.string().max(20).nullable().optional(),
	notes: z.string().max(1000).optional()
});

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(401, 'Login required');
	if (locals.user.isBlocked) error(403, 'Account blocked');

	const body = await request.json();
	const parsed = schema.safeParse(body);
	if (!parsed.success) error(400, 'Invalid status');

	const { status, bibNumber, notes } = parsed.data;
	const userId = locals.user.id;

	// params.id is a distanceId — resolve to editionId
	const dist = await db.query.raceDistances.findFirst({ where: eq(raceDistances.id, params.id) });
	if (!dist) error(404, 'Race not found');
	const editionId = dist.editionId;

	if (status === null) {
		await db
			.delete(raceUserStatus)
			.where(and(eq(raceUserStatus.userId, userId), eq(raceUserStatus.editionId, editionId)));
	} else {
		await db
			.insert(raceUserStatus)
			.values({ userId, editionId, status, bibNumber: bibNumber ?? null, notes, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: [raceUserStatus.userId, raceUserStatus.editionId],
				set: { status, bibNumber: bibNumber ?? null, notes, updatedAt: new Date() }
			});
	}

	return json({ ok: true });
};

