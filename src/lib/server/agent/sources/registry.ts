/**
 * Source registry — defines timing system sources for Nordic running races.
 * These are authoritative timing platforms that list upcoming races directly.
 */

export interface SourceConfig {
	id: string;
	/** Human-readable name */
	name: string;
	/** Which countries this source covers */
	countries: string[];
}

export const SOURCES: SourceConfig[] = [
	{ id: 'eqtiming', name: 'EQ Timing', countries: ['NO', 'SE'] },
	{ id: 'sportstiming', name: 'SportsTiming.dk', countries: ['DK', 'SE'] },
	{ id: 'timataka', name: 'Tímataka.net', countries: ['IS'] },
	{ id: 'racetimer', name: 'RaceTimer.se', countries: ['SE'] },
	{ id: 'kondis', name: 'Kondis.no', countries: ['NO'] },
	{ id: 'friidrett', name: 'Friidrett.no', countries: ['NO'] }
];
