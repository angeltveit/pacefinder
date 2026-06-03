import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { forwardGeocode } from '$lib/server/geo';
import type { PageServerLoad, Actions } from './$types';

const DISTANCE_OPTIONS = ['5k', '10k', 'half', 'marathon', 'ultra', 'trail'] as const;
const AMBITION_OPTIONS = ['casual', 'improver', 'competitive'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');

	const me = await db.query.user.findFirst({ where: eq(user.id, locals.user.id) });

	// Already onboarded — skip to home
	if (me?.onboardedAt) redirect(302, '/');

	return { userName: me?.name ?? locals.user.name };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(302, '/login');

		const form = await request.formData();

		const city = (form.get('city') as string)?.trim() || null;
		const country = (form.get('country') as string)?.trim().toUpperCase() || 'NO';

		const genderRaw = (form.get('gender') as string)?.trim() || '';
		const gender = ['male', 'female', 'other'].includes(genderRaw) ? genderRaw : null;

		const radiusRaw = parseInt((form.get('travelRadiusKm') as string) ?? '', 10);
		const travelRadiusKm = Number.isFinite(radiusRaw) ? Math.min(9999, Math.max(10, radiusRaw)) : 100;

		const targetDistances = (form.getAll('targetDistances') as string[]).filter((d) =>
			DISTANCE_OPTIONS.includes(d as (typeof DISTANCE_OPTIONS)[number])
		);

		const ambitionRaw = (form.get('ambition') as string)?.trim() || '';
		const ambition = AMBITION_OPTIONS.includes(ambitionRaw as (typeof AMBITION_OPTIONS)[number])
			? ambitionRaw
			: null;

		// GPS coords (set by client-side geolocation)
		const latRaw = parseFloat((form.get('homeLat') as string) ?? '');
		const lngRaw = parseFloat((form.get('homeLng') as string) ?? '');
		let homeLat: number | null = Number.isFinite(latRaw) ? latRaw : null;
		let homeLng: number | null = Number.isFinite(lngRaw) ? lngRaw : null;

		// Fall back to geocoding the city if no GPS
		if ((homeLat == null || homeLng == null) && city) {
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
			targetDistances: targetDistances.length ? targetDistances : null,
			ambition,
			onboardedAt: new Date()
		};
		if (homeLat != null && homeLng != null) {
			patch.homeLat = homeLat;
			patch.homeLng = homeLng;
		}

		await db.update(user).set(patch).where(eq(user.id, locals.user.id));
		redirect(302, '/');
	}
};
