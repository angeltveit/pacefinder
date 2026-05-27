import type { RawRaceLead } from '../types';

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

/** Get the leaf sport name (most specific category) */
function getLeafSport(e: EqEvent): string {
	return e.Sport?.Name ?? '';
}

/** Keywords that indicate track & field meets, school events, or non-road races */
const EXCLUDE_KEYWORDS = [
	'rulleski', 'ski ', 'skiskyting', 'orientering',
	'friidrettsstevne', 'stevne', 'innendørs', 'indoor',
	'hallstevne', 'kastdag', 'kast ', 'spyd', 'kule',
	'høyde', 'lengde', 'stav', 'diskos', 'sprint',
	'skolemesterskap', 'skole', 'barneidrett',
	'fleridrett', 'mangekamp', 'tierkamp', 'heptathlon', 'decathlon',
	'gång', 'gang ', 'gå ',
	'stafett cup', 'banesprint'
];

/** Keywords that strongly indicate road/trail running races we want */
const INCLUDE_KEYWORDS = [
	'maraton', 'marathon', 'halvmaraton', 'half marathon',
	'løp', 'run', 'ultraløp', 'ultra', 'mila', 'mil ',
	'trail', 'fjell', 'mountain', 'sti',
	'5k', '10k', '15k', '20k', '3k',
	'5 km', '10 km', '15 km', '21 km', '42 km',
	'motbakke', 'gate', 'terreng', 'cross',
	'birken', 'karusell'
];

/**
 * Scrape EQ Timing's public event API for road/trail running events.
 * Uses keyword heuristics to filter out track & field meets before LLM classification.
 */
export async function scrapeEqTiming(): Promise<RawRaceLead[]> {
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

			const nameLower = e.Name.toLowerCase();
			const leafSport = getLeafSport(e).toLowerCase();

			// Exclude obvious non-road-race events
			if (EXCLUDE_KEYWORDS.some((kw) => nameLower.includes(kw))) continue;

			// If the name doesn't match any running keyword, check leaf sport
			const hasRunKeyword = INCLUDE_KEYWORDS.some((kw) => nameLower.includes(kw));
			if (!hasRunKeyword) {
				// Allow events whose leaf sport clearly indicates running
				const leafOk = ['running', 'road running', 'trail', 'mountain running', 'cross country', 'ultra'].some(
					(s) => leafSport.includes(s)
				);
				// If neither name nor leaf sport indicate running, skip
				if (!leafOk) continue;
			}

			const city = e.City?.Name ?? '';
			const country = e.City?.Country?.Iso2 ?? '';

			leads.push({
				name: e.Name,
				url: `https://live.eqtiming.com/${e.Id}`,
				description: [city, country].filter(Boolean).join(', ') || undefined,
				source: 'eqtiming',
				rawText: `${e.Name} — ${city} ${country} — ${e.Starttime.split('T')[0]}`,
				date: e.Starttime.split('T')[0]
			});
		}

		return leads;
	} catch {
		return [];
	}
}
