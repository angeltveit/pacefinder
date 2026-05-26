import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
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

const patchSchema = z.object({
	name: z.string().min(1).optional(),
	city: z.string().min(1).optional(),
	distanceKm: z.number().nullable().optional(),
	category: z.enum(['local', 'norway', 'international']).optional(),
	raceDate: z.string().nullable().optional(),
	registrationStatus: z.enum(['open', 'opening_soon', 'closed', 'unknown']).optional(),
	medalStatus: z.enum(['confirmed', 'likely', 'unclear']).optional(),
	websiteUrl: z.string().url().nullable().optional().or(z.literal('')),
	registrationUrl: z.string().url().nullable().optional().or(z.literal('')),
	resultsUrl: z.string().url().nullable().optional().or(z.literal('')),
	imageUrl: z.string().url().nullable().optional().or(z.literal('')),
	whyItFits: z.string().nullable().optional()
});

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = await request.json().catch(() => null);
	const parsed = patchSchema.safeParse(body);
	if (!parsed.success) error(400, parsed.error.message);

	const data = parsed.data;

	// Convert empty strings to null for URL fields
	const updates: Record<string, unknown> = { lastUpdatedAt: new Date() };
	if (data.name !== undefined) updates.name = data.name;
	if (data.city !== undefined) updates.city = data.city;
	if (data.distanceKm !== undefined) updates.distanceKm = data.distanceKm;
	if (data.category !== undefined) updates.category = data.category;
	if (data.raceDate !== undefined) updates.raceDate = data.raceDate ? new Date(data.raceDate) : null;
	if (data.registrationStatus !== undefined) updates.registrationStatus = data.registrationStatus;
	if (data.medalStatus !== undefined) updates.medalStatus = data.medalStatus;
	if (data.websiteUrl !== undefined) updates.websiteUrl = data.websiteUrl || null;
	if (data.registrationUrl !== undefined) updates.registrationUrl = data.registrationUrl || null;
	if (data.resultsUrl !== undefined) updates.resultsUrl = data.resultsUrl || null;
	if (data.imageUrl !== undefined) updates.imageUrl = data.imageUrl || null;
	if (data.whyItFits !== undefined) updates.whyItFits = data.whyItFits || null;

	const updated = await db
		.update(races)
		.set(updates)
		.where(eq(races.id, params.id))
		.returning({ id: races.id });

	if (updated.length === 0) error(404, 'Race not found');

	return json({ ok: true });
};
