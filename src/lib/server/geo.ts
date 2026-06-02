/**
 * Geocoding + distance helpers backed by OpenStreetMap Nominatim (free, no key).
 * Nominatim asks for a descriptive User-Agent and a max of ~1 request/second.
 */

const UA = 'PaceFinder/1.0 (race discovery app)';

export type GeoPlace = {
	lat: number;
	lng: number;
	city: string | null;
	region: string | null;
	country: string | null;
};

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

/** Reverse-geocode coordinates → place name. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoPlace | null> {
	try {
		const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
		const res = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			address?: {
				city?: string;
				town?: string;
				village?: string;
				municipality?: string;
				state?: string;
				county?: string;
				country_code?: string;
				country?: string;
			};
		};
		const a = data.address ?? {};
		return {
			lat,
			lng,
			city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
			region: a.state ?? a.county ?? null,
			country: a.country_code ? a.country_code.toUpperCase() : (a.country ?? null)
		};
	} catch {
		return null;
	}
}

/** Forward-geocode a free-text place (e.g. "Oslo, NO") → coordinates. */
export async function forwardGeocode(query: string): Promise<GeoPlace | null> {
	const q = query.trim();
	if (!q) return null;
	try {
		const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
		const res = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return null;
		const rows = (await res.json()) as Array<{
			lat: string;
			lon: string;
			address?: {
				city?: string;
				town?: string;
				village?: string;
				municipality?: string;
				state?: string;
				county?: string;
				country_code?: string;
				country?: string;
			};
		}>;
		const r = rows[0];
		if (!r) return null;
		const a = r.address ?? {};
		return {
			lat: parseFloat(r.lat),
			lng: parseFloat(r.lon),
			city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
			region: a.state ?? a.county ?? null,
			country: a.country_code ? a.country_code.toUpperCase() : (a.country ?? null)
		};
	} catch {
		return null;
	}
}
