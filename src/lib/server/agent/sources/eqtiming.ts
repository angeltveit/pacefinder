import type { RawRaceLead } from '../types';
import { REGION_KEYWORDS } from './registry';

/** EQ Timing public JSON API */
const API_URL = 'https://events.eqtiming.com/api/events';

interface EqEvent {
	Id: number;
	Name: string;
	Starttime: string;
	Signup?: { Cancelled?: boolean };
	Sport?: { Parent?: { Parent?: { Name?: string }; Name?: string }; Name?: string };
	City?: { Name?: string; Country?: { Iso2?: string } };
}

/** Get the top-level sport category from EQ's nested Sport structure */
function getTopSport(e: EqEvent): string {
	return e.Sport?.Parent?.Parent?.Name ?? e.Sport?.Parent?.Name ?? e.Sport?.Name ?? '';
}

/**
 * Scrape EQ Timing's public event API for running-related events
 * in target locations. Returns RawRaceLeads for the agent classifier.
 *
 * @param locationFilter - optional array of location keywords to restrict to.
 *   Defaults to all Norwegian region keywords.
 */
export async function scrapeEqTiming(locationFilter?: string[]): Promise<RawRaceLead[]> {
	const targetLocations = locationFilter ?? getAllNorwegianKeywords();

	try {
		const res = await fetch(API_URL, {
			headers: { 'User-Agent': 'PaceFinder/1.0 (research bot)' },
			signal: AbortSignal.timeout(30_000)
		});
		if (!res.ok) return [];

		const events = (await res.json()) as EqEvent[];
		const leads: RawRaceLead[] = [];
		const now = new Date();
		const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		for (const e of events) {
			// Only future events
			if (!e.Starttime || new Date(e.Starttime) < cutoff) continue;

			// Only Athletics (running) category
			if (getTopSport(e) !== 'Athletics') continue;

			// Skip cancelled
			if (e.Signup?.Cancelled) continue;
			if (e.Name.includes('CANCELLED')) continue;

			// Filter by location — match against city name or event name
			const city = e.City?.Name ?? '';
			const matchText = `${e.Name} ${city}`.toLowerCase();
			const matchesLocation = targetLocations.some((kw) => matchText.includes(kw));
			if (!matchesLocation) continue;

			// Skip obvious non-running keywords in name (some Athletics events are rulleski, etc.)
			const nameLower = e.Name.toLowerCase();
			const nonRunning = ['rulleski', 'ski ', 'skiskyting', 'orientering'];
			if (nonRunning.some((kw) => nameLower.includes(kw))) continue;

			leads.push({
				name: e.Name,
				url: `https://live.eqtiming.com/${e.Id}`,
				description: city ? `Location: ${city}` : undefined,
				source: 'eqtiming',
				rawText: `${e.Name} — ${city} — ${e.Starttime.split('T')[0]}`
			});
		}

		return leads;
	} catch {
		return [];
	}
}

/** Union of all Norwegian region keywords */
function getAllNorwegianKeywords(): string[] {
	const all = new Set<string>();
	for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
		if (region !== 'norway') {
			keywords.forEach((k) => all.add(k));
		}
	}
	return [...all];
}
