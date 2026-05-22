import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { races } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const deleted = await db.delete(races).where(eq(races.id, params.id)).returning({ id: races.id });
	if (deleted.length === 0) error(404, 'Race not found');

	return json({ ok: true });
};
