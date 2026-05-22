export interface RawRaceLead {
	name: string;
	description?: string;
	url: string;
	source: string;
	rawText?: string;
}

export interface ClassifiedRace {
	name: string;
	category: 'local' | 'norway' | 'international';
	distanceKm: number | null;
	location: string | null;
	city: string;
	country: string;
	raceDate: Date | null;
	registrationUrl: string | null;
	sourceUrl: string;
	medalStatus: 'confirmed' | 'likely' | 'unclear';
	registrationStatus: 'open' | 'opening_soon' | 'unknown' | 'closed';
	whyItFits: string;
	rawLlmOutput: unknown;
	fingerprint: string;
}
