/**
 * Source registry — defines where to scrape and which geographic regions each source covers.
 * Sources tagged with a region are only invoked when looking for races in that region.
 * Sources with no region (global) are always invoked.
 */

export interface SourceConfig {
	id: string;
	/** Human-readable name */
	name: string;
	/** Which regions this source covers. Empty = global. */
	regions: string[];
	/** Sport types this source covers. Empty = running only. */
	sports?: string[];
}

/**
 * Known regions and their location keywords.
 * Used to match EQ Timing / other locale-based sources against events.
 */
export const REGION_KEYWORDS: Record<string, string[]> = {
	bergen: [
		'bergen', 'fana', 'åsane', 'askøy', 'sotra', 'os', 'arna', 'fyllingsdalen',
		'laksevåg', 'loddefjord', 'nordhordland', 'knarvik', 'osterøy', 'voss',
		'stord', 'bømlo', 'sunnhordland', 'dale', 'vaksdal'
	],
	vestland: [
		'bergen', 'voss', 'stord', 'odda', 'hardanger', 'sunnfjord', 'førde',
		'florø', 'sogndal', 'lærdal', 'dale', 'nordhordland', 'askøy'
	],
	oslo: [
		'oslo', 'bærum', 'asker', 'lillestrøm', 'lørenskog', 'oppegård',
		'nesodden', 'ski', 'kolbotn', 'fornebu', 'bislett'
	],
	stavanger: [
		'stavanger', 'sandnes', 'sola', 'randaberg', 'jæren', 'haugesund', 'karmøy'
	],
	trondheim: [
		'trondheim', 'stjørdal', 'melhus', 'klæbu', 'malvik', 'heimdal'
	],
	tromsø: ['tromsø', 'tromsoe', 'kvaløya', 'tromsdalen'],
	norway: [] // catch-all for all Norwegian sources
};

export const SOURCES: SourceConfig[] = [
	{ id: 'kondis', name: 'Kondis.no', regions: ['norway'] },
	{ id: 'friidrett', name: 'Friidrett.no', regions: ['norway'] },
	{ id: 'eqtiming', name: 'EQ Timing', regions: ['norway'] },
	{ id: 'tavily', name: 'Tavily Search', regions: [] },
	{ id: 'google', name: 'Google Custom Search', regions: [] }
];

/** Returns location keywords to scrape for a given set of target regions */
export function getLocationKeywords(regions: string[]): string[] {
	const keywords = new Set<string>();
	for (const region of regions) {
		const kws = REGION_KEYWORDS[region];
		if (kws) kws.forEach((k) => keywords.add(k));
	}
	return [...keywords];
}
