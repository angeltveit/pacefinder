import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { comments } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	await db
		.update(comments)
		.set({ deletedAt: new Date() })
		.where(eq(comments.id, params.id));

	return json({ ok: true });
};
