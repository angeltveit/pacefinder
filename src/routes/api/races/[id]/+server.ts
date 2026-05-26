import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const deleted = await db
		.delete(raceDistances)
		.where(eq(raceDistances.id, params.id))
		.returning({ id: raceDistances.id });
	if (deleted.length === 0) error(404, 'Race not found');

	// Cascade-clean empty editions / series
	await db.execute(sql`
		DELETE FROM race_editions WHERE id NOT IN (SELECT edition_id FROM race_distances)
	`);
	await db.execute(sql`
		DELETE FROM race_series WHERE id NOT IN (SELECT series_id FROM race_editions)
	`);

	return json({ ok: true });
};

const patchSchema = z.object({
	name: z.string().min(1).optional(),
	distanceKm: z.number().nullable().optional(),
	registrationUrl: z.string().url().nullable().optional().or(z.literal('')),
	resultsUrl: z.string().url().nullable().optional().or(z.literal('')),
	medalStatus: z.enum(['confirmed', 'likely', 'unclear']).optional(),
	// Edition-level fields
	raceDate: z.string().nullable().optional(),
	registrationStatus: z.enum(['open', 'opening_soon', 'closed', 'unknown']).optional(),
	websiteUrl: z.string().url().nullable().optional().or(z.literal('')),
	// Series-level fields
	category: z.enum(['local', 'norway', 'international']).optional(),
	city: z.string().min(1).optional(),
	imageUrl: z.string().url().nullable().optional().or(z.literal('')),
	whyItFits: z.string().nullable().optional()
});

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const body = await request.json().catch(() => null);
	const parsed = patchSchema.safeParse(body);
	if (!parsed.success) error(400, parsed.error.message);

	const data = parsed.data;

	// Find the distance and its edition+series IDs
	const rows = await db
		.select({
			editionId: raceDistances.editionId,
			seriesId: raceEditions.seriesId
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.where(eq(raceDistances.id, params.id))
		.limit(1);

	if (rows.length === 0) error(404, 'Race not found');
	const { editionId, seriesId } = rows[0];

	const now = new Date();

	// Update race_distances
	const distUpdates: Record<string, unknown> = { lastUpdatedAt: now };
	if (data.name !== undefined) distUpdates.name = data.name;
	if (data.distanceKm !== undefined) distUpdates.distanceKm = data.distanceKm;
	if (data.registrationUrl !== undefined) distUpdates.registrationUrl = data.registrationUrl || null;
	if (data.resultsUrl !== undefined) distUpdates.resultsUrl = data.resultsUrl || null;
	if (data.medalStatus !== undefined) distUpdates.medalStatus = data.medalStatus;
	if (Object.keys(distUpdates).length > 1) {
		await db.update(raceDistances).set(distUpdates).where(eq(raceDistances.id, params.id));
	}

	// Update race_editions
	const editUpdates: Record<string, unknown> = { lastUpdatedAt: now };
	if (data.raceDate !== undefined) editUpdates.raceDate = data.raceDate ? new Date(data.raceDate) : null;
	if (data.registrationStatus !== undefined) editUpdates.registrationStatus = data.registrationStatus;
	if (data.websiteUrl !== undefined) editUpdates.websiteUrl = data.websiteUrl || null;
	if (Object.keys(editUpdates).length > 1) {
		await db.update(raceEditions).set(editUpdates).where(eq(raceEditions.id, editionId));
	}

	// Update race_series
	const seriesUpdates: Record<string, unknown> = { lastUpdatedAt: now };
	if (data.category !== undefined) seriesUpdates.category = data.category;
	if (data.city !== undefined) seriesUpdates.city = data.city;
	if (data.imageUrl !== undefined) seriesUpdates.imageUrl = data.imageUrl || null;
	if (data.whyItFits !== undefined) seriesUpdates.whyItFits = data.whyItFits || null;
	if (Object.keys(seriesUpdates).length > 1) {
		await db.update(raceSeries).set(seriesUpdates).where(eq(raceSeries.id, seriesId));
	}

	return json({ ok: true });
};


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
