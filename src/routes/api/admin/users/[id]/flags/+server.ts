import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { isKnownFlag, setUserFlag } from '$lib/server/featureFlags';
import type { RequestHandler } from './$types';

const schema = z.object({ flag: z.string(), enabled: z.boolean() });

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const parsed = schema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Invalid request');
	if (!isKnownFlag(parsed.data.flag)) error(400, 'Unknown flag');

	await setUserFlag(params.id, parsed.data.flag, parsed.data.enabled);

	return json({ ok: true });
};
