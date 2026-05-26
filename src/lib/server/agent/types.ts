export interface RawRaceLead {
	name: string;
	description?: string;
	url: string;
	source: string;
	rawText?: string;
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
	whyItFits: string;
	rawLlmOutput: unknown;
	fingerprint: string;
}
