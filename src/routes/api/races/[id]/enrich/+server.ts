import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { races } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { enrichRaces } from '$lib/server/agent/enrichment';
import { searchAllTimingProviders } from '$lib/server/agent/results';
import type { ClassifiedRace } from '$lib/server/agent/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const race = await db.query.races.findFirst({ where: eq(races.id, params.id) });
	if (!race) error(404, 'Race not found');

	const log: string[] = [];
	const onLog = (msg: string) => log.push(msg);

	// Convert DB race to ClassifiedRace shape for enrichment
	const classified: ClassifiedRace = {
		name: race.name,
		eventName: race.eventName ?? race.name,
		category: race.category as 'local' | 'norway' | 'international',
		distanceKm: race.distanceKm,
		location: race.location,
		city: race.city,
		country: race.country,
		raceDate: race.raceDate,
		registrationUrl: race.registrationUrl,
		resultsUrl: race.resultsUrl,
		websiteUrl: race.websiteUrl,
		imageUrl: race.imageUrl,
		sourceUrl: race.sourceUrl ?? '',
		medalStatus: race.medalStatus as 'confirmed' | 'likely' | 'unclear',
		registrationStatus: race.registrationStatus as 'open' | 'opening_soon' | 'unknown' | 'closed',
		whyItFits: race.whyItFits ?? '',
		rawLlmOutput: race.rawLlmOutput,
		fingerprint: race.fingerprint
	};

	// Run enrichment on this single race
	const [enriched] = await enrichRaces([classified], onLog);

	// Auto-discover results URL on timing providers if enrichment didn't find one
	if (!enriched.resultsUrl && !race.resultsUrl) {
		onLog('Searching timing providers for results URL…');
		const url = await searchAllTimingProviders(enriched.name, enriched.raceDate, onLog);
		if (url) enriched.resultsUrl = url;
	}

	// Update the DB with any new findings
	await db
		.update(races)
		.set({
			raceDate: enriched.raceDate ?? race.raceDate,
			registrationUrl: enriched.registrationUrl ?? race.registrationUrl,
			resultsUrl: enriched.resultsUrl ?? race.resultsUrl,
			websiteUrl: enriched.websiteUrl ?? race.websiteUrl,
			imageUrl: enriched.imageUrl ?? race.imageUrl,
			medalStatus: enriched.medalStatus ?? race.medalStatus,
			lastUpdatedAt: new Date()
		})
		.where(eq(races.id, params.id));

	return json({ ok: true, log });
};
