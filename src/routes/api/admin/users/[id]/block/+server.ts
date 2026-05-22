import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const schema = z.object({ blocked: z.boolean() });

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = await request.json();
	const parsed = schema.safeParse(body);
	if (!parsed.success) error(400, 'Invalid request');

	await db
		.update(user)
		.set({
			isBlocked: parsed.data.blocked,
			blockedAt: parsed.data.blocked ? new Date() : null,
			blockedBy: parsed.data.blocked ? locals.user.id : null
		})
		.where(eq(user.id, params.id));

	return json({ ok: true });
};
