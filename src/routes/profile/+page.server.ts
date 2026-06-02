import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceUserStatus, user } from '$lib/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { forwardGeocode } from '$lib/server/geo';
import type { PageServerLoad, Actions } from './$types';

const DISTANCE_OPTIONS = ['5k', '10k', 'half', 'marathon', 'ultra', 'trail'] as const;
const AMBITION_OPTIONS = ['casual', 'improver', 'competitive'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');

	const me = await db.query.user.findFirst({ where: eq(user.id, locals.user.id) });

	const triaged = await db
		.select({
			status: raceUserStatus.status,
			notes: raceUserStatus.notes,
			updatedAt: raceUserStatus.updatedAt,
			// Link to the first (lowest km) distance in the edition
			raceId: sql<string>`(select id from race_distances where edition_id = ${raceEditions.id} order by distance_km asc nulls last limit 1)`,
			eventName: raceSeries.name,
			city: raceSeries.city,
			country: raceSeries.country,
			category: raceSeries.category,
			raceDate: raceEditions.raceDate,
			registrationStatus: raceEditions.registrationStatus,
			websiteUrl: sql<string | null>`coalesce(${raceEditions.websiteUrl}, ${raceSeries.websiteUrl})`,
			firstSeenAt: raceEditions.firstSeenAt
		})
		.from(raceUserStatus)
		.innerJoin(raceEditions, eq(raceEditions.id, raceUserStatus.editionId))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceUserStatus.userId, locals.user.id))
		.orderBy(desc(raceUserStatus.updatedAt));

	return {
		triaged: triaged.map((t) => ({
			status: t.status,
			notes: t.notes,
			updatedAt: t.updatedAt.toISOString(),
			race: {
				id: t.raceId,
				name: t.eventName,
				eventName: t.eventName,
				distanceKm: null,
				city: t.city,
				country: t.country,
				category: t.category,
				raceDate: t.raceDate?.toISOString() ?? null,
				medalStatus: null,
				registrationStatus: t.registrationStatus,
				websiteUrl: t.websiteUrl,
				firstSeenAt: t.firstSeenAt.toISOString()
			}
		})),
		userCity: me?.city ?? '',
		userCountry: me?.country ?? 'NO',
		userGender: (me as { gender?: string | null } | undefined)?.gender ?? '',
		userTravelRadiusKm: me?.travelRadiusKm ?? 150,
		userTargetDistances: (me?.targetDistances as string[] | null) ?? [],
		userAmbition: me?.ambition ?? '',
		hasCoords: me?.homeLat != null && me?.homeLng != null
	};
};

export const actions: Actions = {
	updateLocation: async ({ request, locals }) => {
		if (!locals.user) redirect(302, '/login');
		const form = await request.formData();
		const city = (form.get('city') as string)?.trim() || null;
		const country = (form.get('country') as string)?.trim().toUpperCase() || null;
		const genderRaw = (form.get('gender') as string)?.trim() || '';
		const gender = ['male', 'female', 'other'].includes(genderRaw) ? genderRaw : null;

		const radiusRaw = parseInt((form.get('travelRadiusKm') as string) ?? '', 10);
		const travelRadiusKm = Number.isFinite(radiusRaw)
			? Math.min(2000, Math.max(5, radiusRaw))
			: 150;

		const targetDistances = (form.getAll('targetDistances') as string[]).filter((d) =>
			DISTANCE_OPTIONS.includes(d as (typeof DISTANCE_OPTIONS)[number])
		);

		const ambitionRaw = (form.get('ambition') as string)?.trim() || '';
		const ambition = AMBITION_OPTIONS.includes(ambitionRaw as (typeof AMBITION_OPTIONS)[number])
			? ambitionRaw
			: null;

		// Geocode the home city so the "For You" feed can rank by real distance.
		let homeLat: number | null = null;
		let homeLng: number | null = null;
		if (city) {
			const place = await forwardGeocode(country ? `${city}, ${country}` : city);
			if (place) {
				homeLat = place.lat;
				homeLng = place.lng;
			}
		}

		const patch: Record<string, unknown> = {
			city,
			country,
			gender,
			travelRadiusKm,
			targetDistances,
			ambition
		};
		// Only overwrite coords when we successfully geocoded (don't wipe a good GPS fix).
		if (homeLat != null && homeLng != null) {
			patch.homeLat = homeLat;
			patch.homeLng = homeLng;
		}

		await db.update(user).set(patch).where(eq(user.id, locals.user.id));
		return { success: true };
	}
};
