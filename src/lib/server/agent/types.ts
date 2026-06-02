export interface RawRaceLead {
	name: string;
	description?: string;
	url: string;
	source: string;
	rawText?: string;
	/** ISO date string (YYYY-MM-DD) if known at scrape time, used for pre-LLM filtering */
	date?: string;
}

/** Practical "things runners always wonder about" info, extracted by the enrichment agent.
 *  Each field is a short human-readable string, or null/undefined when not found. */
export interface RaceDayInfo {
	/** Venue / start-finish area address or clear location, e.g. "Festplassen, 5014 Bergen". */
	address?: string | null;
	/** Start time(s) for distances/waves, e.g. "10K 19:00, 5K 19:15" or "first start 09:00". */
	startTimes?: string | null;
	/** Where & when to collect race bibs/numbers. */
	bibPickup?: string | null;
	/** Toilets, changing rooms, wardrobe / bag storage. */
	facilities?: string | null;
	/** Food, drinks, expo, entertainment, kids races, after-party, other side events. */
	extras?: string | null;
}

export interface ClassifiedRace {
	name: string;
	eventName: string;
	category: 'local' | 'norway' | 'international';
	distanceKm: number | null;
	/** Set by enrichment when the official site lists multiple distances, e.g. [5, 10] */
	enrichedDistancesKm?: number[];
	location: string | null;
	city: string;
	country: string;
	raceDate: Date | null;
	registrationUrl: string | null;
	resultsUrl: string | null;
	websiteUrl: string | null;
	imageUrl: string | null;
	sourceUrl: string;
	medalStatus: 'confirmed' | 'likely' | 'unclear';
	registrationStatus: 'open' | 'opening_soon' | 'unknown' | 'closed';
	/** Enrichment-extracted facts (optional, populated by the web agent) */
	registrationDeadline?: Date | null;
	priceMin?: number | null;
	priceMax?: number | null;
	priceCurrency?: string | null;
	fieldSize?: number | null;
	confidence?: number | null;
	elevationGainM?: number | null;
	surface?: 'road' | 'trail' | 'mixed' | 'track' | null;
	/** Practical race-day info found by the web agent (address, start times, bib pickup, facilities, extras) */
	raceDayInfo?: RaceDayInfo | null;
	whyItFits: string;
	rawLlmOutput: unknown;
	fingerprint: string;
}
