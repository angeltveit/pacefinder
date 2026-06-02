import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { reverseGeocode } from '$lib/server/geo';
import type { RequestHandler } from './$types';

const schema = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = schema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Invalid coordinates');

	const { lat, lng } = parsed.data;
	const place = await reverseGeocode(lat, lng);

	await db
		.update(user)
		.set({
			homeLat: lat,
			homeLng: lng,
			...(place?.city ? { city: place.city } : {}),
			...(place?.country ? { country: place.country } : {})
		})
		.where(eq(user.id, locals.user.id));

	return json({
		ok: true,
		city: place?.city ?? null,
		country: place?.country ?? null
	});
};
