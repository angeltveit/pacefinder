import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { comments } from '$lib/server/db/schema';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const schema = z.object({
	body: z.string().min(1).max(2000).trim()
});

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(401, 'Login required');
	if (locals.user.isBlocked) error(403, 'Account blocked');

	const raw = await request.json();
	const parsed = schema.safeParse(raw);
	if (!parsed.success) error(400, 'Invalid comment');

	const [comment] = await db
		.insert(comments)
		.values({ raceId: params.id, userId: locals.user.id, body: parsed.data.body })
		.returning();

	return json({ ok: true, comment });
};
