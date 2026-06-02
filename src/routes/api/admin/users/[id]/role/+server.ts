import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const schema = z.object({ role: z.enum(['user', 'admin']) });

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');
	if (params.id === locals.user.id) error(400, 'Cannot change your own role');

	const body = await request.json();
	const parsed = schema.safeParse(body);
	if (!parsed.success) error(400, 'Invalid request');

	await db
		.update(user)
		.set({ role: parsed.data.role })
		.where(eq(user.id, params.id));

	return json({ ok: true });
};
