/**
 * Shared presentation helpers — category theming, distance/date formatting,
 * and deterministic topographic art. Used across cards, feed, and detail pages.
 */

export type Category = 'local' | 'norway' | 'international' | string;

/**
 * Route a remote race photo through the server-side proxy so the browser never
 * hotlinks it directly (avoids ERR_BLOCKED_BY_ORB / hotlink protection). Local
 * and already-proxied/relative URLs are returned untouched.
 */
export function proxyImage(src: string | null | undefined): string | null {
	if (!src) return null;
	if (src.startsWith('/') || src.startsWith('data:')) return src;
	if (!/^https?:\/\//i.test(src)) return src;
	return `/api/img?url=${encodeURIComponent(src)}`;
}

export interface CategoryTheme {
	key: 'local' | 'travel' | 'bucket';
	color: string; // hex accent
	soft: string; // translucent fill
	label: string; // human label
	icon: string; // Icon name
}

const LOCAL: CategoryTheme = {
	key: 'local',
	color: '#2dd4bf',
	soft: 'rgba(45,212,191,0.14)',
	label: 'Local',
	icon: 'route'
};
const TRAVEL: CategoryTheme = {
	key: 'travel',
	color: '#a78bfa',
	soft: 'rgba(167,139,250,0.14)',
	label: 'Weekend trip',
	icon: 'mountain'
};
const BUCKET: CategoryTheme = {
	key: 'bucket',
	color: '#fbbf24',
	soft: 'rgba(251,191,36,0.14)',
	label: 'Bucket list',
	icon: 'plane'
};

export function categoryTheme(category: Category): CategoryTheme {
	if (category === 'local') return LOCAL;
	if (category === 'norway') return TRAVEL;
	return BUCKET;
}

/** A more specific label that factors in the longest distance offered. */
export function categoryBadge(category: Category, maxKm: number): string {
	const t = categoryTheme(category);
	if (t.key === 'local') {
		if (maxKm >= 42) return 'Local marathon';
		if (maxKm >= 21) return 'Local half';
		return 'Local race';
	}
	if (t.key === 'travel') {
		if (maxKm >= 42) return 'Epic Norway';
		return 'Weekend trip';
	}
	return 'Bucket list';
}

export function distanceLabel(km: number | null): string {
	if (km == null) return 'TBA';
	if (km >= 42 && km <= 43) return 'Marathon';
	if (km >= 21 && km <= 22) return 'Half';
	if (km > 43) return `${Math.round(km)}K Ultra`;
	if (km === Math.round(km)) return `${Math.round(km)}K`;
	return `${km}K`;
}

export function formatDate(d: string | Date | null): string {
	if (!d) return 'Date TBA';
	const date = typeof d === 'string' ? new Date(d) : d;
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(d: string | Date | null): { day: string; month: string } | null {
	if (!d) return null;
	const date = typeof d === 'string' ? new Date(d) : d;
	return {
		day: date.toLocaleDateString('en-GB', { day: 'numeric' }),
		month: date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
	};
}

/** Days until a date (negative if past). null when unknown. */
export function daysUntil(d: string | Date | null): number | null {
	if (!d) return null;
	const date = typeof d === 'string' ? new Date(d) : d;
	const ms = date.getTime() - Date.now();
	return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** Stable hash for deterministic art. */
export function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

// ─── Gamified avatars ─────────────────────────────────────────────────────────

const AVATAR_COLORS = [
	['#2dd4bf', '#0f766e'],
	['#a78bfa', '#6d28d9'],
	['#fbbf24', '#b45309'],
	['#f472b6', '#be185d'],
	['#60a5fa', '#1d4ed8'],
	['#34d399', '#047857'],
	['#fb7185', '#9f1239'],
	['#c4f042', '#5a7d10']
];

/** Deterministic gradient + initials for a user avatar. */
export function avatar(name: string): { from: string; to: string; initials: string } {
	const [from, to] = AVATAR_COLORS[hashString(name || '?') % AVATAR_COLORS.length];
	const parts = (name || '?').trim().split(/\s+/);
	const initials = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
	return { from, to, initials };
}

// ─── Rich race narrative ───────────────────────────────────────────────────────

export interface NarrativeRace {
	eventName: string;
	city: string;
	country: string;
	category: Category;
	distanceKm: number | null;
	medalStatus: string;
	surface?: string | null;
	elevationGainM?: number | null;
	fieldSize?: number | null;
	raceDate?: string | Date | null;
	priceMin?: number | null;
	priceMax?: number | null;
	priceCurrency?: string | null;
	whyItFits?: string | null;
}

function seasonOf(d: string | Date | null | undefined): string | null {
	if (!d) return null;
	const m = (typeof d === 'string' ? new Date(d) : d).getMonth();
	if (m <= 1 || m === 11) return 'the crisp heart of winter';
	if (m <= 4) return 'fresh spring';
	if (m <= 7) return 'high summer';
	return 'golden autumn';
}

function pick<T>(seed: number, arr: T[]): T {
	return arr[seed % arr.length];
}

/**
 * Build grounded, evocative multi-paragraph copy from the facts we actually have.
 * Avoids inventing specific unverifiable claims; leans on distance, surface,
 * elevation, season, medal, field size and travel category.
 */
export function raceNarrative(r: NarrativeRace): string[] {
	const seed = hashString(r.eventName + r.city);
	const t = categoryTheme(r.category);
	const dist = distanceLabel(r.distanceKm);
	const km = r.distanceKm ?? 0;
	const season = seasonOf(r.raceDate);
	const nameLc0 = r.eventName.toLowerCase();
	const TRAIL_RE = /\b(fjell|trail|terreng|sti|motbakke|mountain|ultra|skyrace|backyard)\b/;
	const trailish = TRAIL_RE.test(nameLc0) || r.surface === 'trail';
	const paras: string[] = [];

	// — Opening: what & where —
	const distancePhrase =
		km >= 42 ? 'a full marathon' : km >= 21 ? 'a half marathon' : km > 0 ? `a ${dist}` : 'a race';
	const localOpen = trailish
		? 'It\'s a home-region adventure — no flights, no hotels, just you, the terrain, and a number on your chest.'
		: 'It\'s the kind of race you can roll out of bed and run — no flights, no hotels, just your local roads and a number on your chest.';
	const openVariants = [
		`${r.eventName} is ${distancePhrase} based in ${r.city}${season ? `, set against ${season}` : ''}. ${
			t.key === 'local'
				? localOpen
				: t.key === 'travel'
					? 'Close enough for a weekend away, far enough to feel like a proper adventure.'
					: 'One for the bucket list — the sort of trip you plan a whole season around.'
		}`,
		`Lace up for ${r.eventName}: ${distancePhrase} in ${r.city}${season ? ` during ${season}` : ''}. ${
			t.key === 'local'
				? trailish
					? 'A home-turf challenge where the terrain does the talking.'
					: 'A home-turf challenge where every kilometre runs through familiar streets.'
				: t.key === 'travel'
					? 'A short hop from home that still delivers a real change of scenery.'
					: 'A marquee destination race worth crossing borders for.'
		}`
	];
	paras.push(pick(seed, openVariants));

	// — Terrain / experience —
	const surface = r.surface ?? (trailish ? 'trail' : null);
	const terrainBits: string[] = [];
	if (surface === 'trail') terrainBits.push('You\'ll be off the tarmac and onto the trails, where pacing matters less than footing and grit.');
	else if (surface === 'mixed') terrainBits.push('Expect a mix of road and trail — a course that keeps your legs guessing.');
	else if (surface === 'track') terrainBits.push('Run on the track, where every lap is measured and every second counts.');
	else terrainBits.push('A road course, fast and honest, where your training shows up in the splits.');

	if (r.elevationGainM && r.elevationGainM >= 400) {
		terrainBits.push(`With around ${Math.round(r.elevationGainM)} m of climbing, this is a proper test of the legs and lungs — train the hills and respect the descents.`);
	} else if (r.elevationGainM && r.elevationGainM >= 100) {
		terrainBits.push(`A rolling profile with roughly ${Math.round(r.elevationGainM)} m of gain keeps things interesting without breaking you.`);
	} else if (km >= 21) {
		terrainBits.push('The profile rewards even pacing — settle in, find your rhythm, and let the finish come to you.');
	}
	paras.push(terrainBits.join(' '));

	// — Payoff: medal / community / why go —
	const payoffBits: string[] = [];
	if (r.medalStatus === 'confirmed') payoffBits.push('Cross the line and a finisher medal is yours to keep — proof for the shelf and the story.');
	else if (r.medalStatus === 'likely') payoffBits.push('There\'s very likely a finisher medal waiting at the line.');
	if (r.fieldSize && r.fieldSize >= 2000) payoffBits.push(`Expect a big-event buzz with thousands of runners and crowds to carry you home.`);
	else if (r.fieldSize && r.fieldSize >= 300) payoffBits.push('A friendly mid-size field — competitive up front, welcoming throughout.');
	else if (r.fieldSize) payoffBits.push('An intimate field where the atmosphere feels personal and every finisher gets noticed.');
	if (r.whyItFits) payoffBits.push(r.whyItFits);
	if (payoffBits.length === 0) payoffBits.push('Whatever your goal — a first finish, a shiny PB, or just a great day out — this one earns its place on the calendar.');
	paras.push(payoffBits.join(' '));

	return paras.filter(Boolean);
}

/** Compact highlight bullets for the "Good to know" strip. */
export function raceHighlights(r: NarrativeRace): { icon: string; text: string }[] {
	const out: { icon: string; text: string }[] = [];
	const dist = distanceLabel(r.distanceKm);
	if (r.distanceKm) out.push({ icon: 'route', text: `${dist} · ${r.distanceKm} km` });
	if (r.surface) out.push({ icon: r.surface === 'trail' ? 'mountain' : 'route', text: `${r.surface} course` });
	if (r.elevationGainM) out.push({ icon: 'mountain', text: `${Math.round(r.elevationGainM)} m of climbing` });
	if (r.medalStatus === 'confirmed') out.push({ icon: 'medal', text: 'Finisher medal' });
	else if (r.medalStatus === 'likely') out.push({ icon: 'medal', text: 'Medal likely' });
	if (r.fieldSize) out.push({ icon: 'users', text: `${r.fieldSize.toLocaleString('en')} runners` });
	const season = seasonOf(r.raceDate);
	if (season) out.push({ icon: 'calendar', text: season.replace('the ', '') });
	return out.slice(0, 6);
}

/** Generate a set of smooth contour-line paths keyed to a seed (topographic art). */
export function topoLines(seed: string, count = 6): string[] {
	const h = hashString(seed);
	const paths: string[] = [];
	for (let i = 0; i < count; i++) {
		const base = 18 + i * 16 + ((h >> (i * 2)) % 8);
		const a1 = 8 + ((h >> (i * 3)) % 16);
		const a2 = 6 + ((h >> (i * 5)) % 14);
		const p1x = 100 + ((h >> (i + 1)) % 60);
		const p2x = 220 + ((h >> (i + 2)) % 60);
		paths.push(
			`M -10 ${base} C ${p1x} ${base - a1}, ${p2x} ${base + a2}, 410 ${base - a1 / 2}`
		);
	}
	return paths;
}
