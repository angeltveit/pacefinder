/**
 * Backfill geocoded coordinates (lat/lng) for race_series rows that don't have them yet.
 * Uses OpenStreetMap Nominatim, rate-limited to ~1 request/second.
 *
 *   npx tsx scripts/geocode-series.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DB_CONNECTION || 'postgresql://localhost:5432/race_lookup');
const UA = 'PaceFinder/1.0 (race discovery app)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
	try {
		const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
		const res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (!res.ok) return null;
		const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
		const r = rows[0];
		return r ? { lat: parseFloat(r.lat), lng: parseFloat(r.lon) } : null;
	} catch {
		return null;
	}
}

const rows = await sql<{ id: string; name: string; city: string; country: string }[]>`
	select id, name, city, country from race_series
	where lat is null or lng is null
`;

console.log(`Geocoding ${rows.length} series…`);
let ok = 0;
for (const r of rows) {
	const queries = [
		`${r.city}, ${r.country}`,
		r.city,
		`${r.name}, ${r.country}`
	].filter(Boolean);

	let coords: { lat: number; lng: number } | null = null;
	for (const q of queries) {
		coords = await geocode(q);
		await sleep(1100); // respect Nominatim rate limit
		if (coords) break;
	}

	if (coords) {
		await sql`update race_series set lat = ${coords.lat}, lng = ${coords.lng} where id = ${r.id}`;
		ok++;
		console.log(`  ✓ ${r.name} (${r.city}) → ${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`);
	} else {
		console.log(`  ✗ ${r.name} (${r.city}) — no match`);
	}
}

console.log(`Done. ${ok}/${rows.length} geocoded.`);
await sql.end();
