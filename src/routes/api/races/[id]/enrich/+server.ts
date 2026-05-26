import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions, raceDistances } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { enrichRaces } from '$lib/server/agent/enrichment';
import { searchAllTimingProviders } from '$lib/server/agent/results';
import type { ClassifiedRace } from '$lib/server/agent/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const rows = await db
		.select({
			distance: raceDistances,
			edition: raceEditions,
			series: raceSeries
		})
		.from(raceDistances)
		.innerJoin(raceEditions, eq(raceDistances.editionId, raceEditions.id))
		.innerJoin(raceSeries, eq(raceEditions.seriesId, raceSeries.id))
		.where(eq(raceDistances.id, params.id))
		.limit(1);

	if (rows.length === 0) error(404, 'Race not found');
	const { distance, edition, series } = rows[0];

	const log: string[] = [];
	const onLog = (msg: string) => log.push(msg);

	// Flatten into ClassifiedRace shape for the enricher
	const classified: ClassifiedRace = {
		name: distance.name,
		eventName: series.name,
		category: series.category as 'local' | 'norway' | 'international',
		distanceKm: distance.distanceKm,
		location: edition.location,
		city: series.city,
		country: series.country,
		raceDate: edition.raceDate,
		registrationUrl: distance.registrationUrl,
		resultsUrl: distance.resultsUrl,
		websiteUrl: edition.websiteUrl ?? series.websiteUrl,
		imageUrl: series.imageUrl,
		sourceUrl: edition.sourceUrl ?? '',
		medalStatus: distance.medalStatus as 'confirmed' | 'likely' | 'unclear',
		registrationStatus: edition.registrationStatus as 'open' | 'opening_soon' | 'unknown' | 'closed',
		whyItFits: series.whyItFits ?? '',
		rawLlmOutput: edition.rawLlmOutput,
		fingerprint: edition.editionFingerprint
	};

	const [enriched] = await enrichRaces([classified], onLog);

	if (!enriched.resultsUrl && !distance.resultsUrl) {
		onLog('Searching timing providers for results URL…');
		const url = await searchAllTimingProviders(enriched.name, enriched.raceDate, onLog);
		if (url) enriched.resultsUrl = url;
	}

	// Save enriched data back across the 3 tables
	await db.update(raceDistances).set({
		registrationUrl: enriched.registrationUrl ?? distance.registrationUrl,
		resultsUrl: enriched.resultsUrl ?? distance.resultsUrl,
		medalStatus: enriched.medalStatus ?? distance.medalStatus,
		lastUpdatedAt: new Date()
	}).where(eq(raceDistances.id, params.id));

	await db.update(raceEditions).set({
		raceDate: enriched.raceDate ?? edition.raceDate,
		websiteUrl: enriched.websiteUrl ?? edition.websiteUrl,
		lastUpdatedAt: new Date()
	}).where(eq(raceEditions.id, edition.id));

	await db.update(raceSeries).set({
		imageUrl: enriched.imageUrl ?? series.imageUrl,
		lastUpdatedAt: new Date()
	}).where(eq(raceSeries.id, series.id));

	return json({ ok: true, log });
};
