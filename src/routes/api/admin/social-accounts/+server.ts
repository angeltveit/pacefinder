import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { socialAccounts } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const createSchema = z.object({
	platform: z.enum(['instagram', 'tiktok']),
	handle: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._]+$/, 'Invalid handle')
});

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');
	const accounts = await db.select().from(socialAccounts);
	return json(accounts);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = await request.json();
	const parsed = createSchema.safeParse(body);
	if (!parsed.success) error(400, 'Invalid account data');

	const [account] = await db
		.insert(socialAccounts)
		.values({ ...parsed.data, addedBy: locals.user.id })
		.returning();

	return json(account, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const { id } = await request.json();
	if (!id) error(400, 'id required');

	await db.delete(socialAccounts).where(eq(socialAccounts.id, id));
	return json({ ok: true });
};
