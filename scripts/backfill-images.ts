/**
 * Backfill/refresh images for races using Tavily image search.
 * Run with: npx tsx scripts/backfill-images.ts
 * Add --force to refresh ALL images (not just missing ones).
 */
import 'dotenv/config';
import postgres from 'postgres';

const DB_URL = process.env.DB_CONNECTION || 'postgresql://localhost:5432/race_lookup';
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const FORCE = process.argv.includes('--force');

const sql = postgres(DB_URL);

const landmarks: Record<string, string> = {
	'berlin': 'Brandenburg Gate runners crowd',
	'paris': 'Champs-Élysées runners pack',
	'new york': 'Verrazzano Bridge start crowd',
	'chicago': 'Grant Park runners skyline',
	'london': 'Tower Bridge runners',
	'tokyo': 'Shinjuku runners pack',
	'boston': 'Boylston Street finish crowd',
	'valencia': 'City of Arts runners',
	'stockholm': 'runners Gamla Stan',
	'copenhagen': 'runners waterfront pack',
	'amsterdam': 'runners canals crowd',
	'oslo': 'runners Rådhusplassen start',
	'bergen': 'runners Bryggen crowd',
	'trondheim': 'runners Nidarosdomen',
	'tromsø': 'runners midnight sun crowd',
	'stavanger': 'runners fjord crowd',
};

function buildQuery(name: string, city: string, distanceKm: number | null): string {
	const cleanName = name.replace(/\d{4}/, '').replace(/–.*/, '').trim();
	const km = distanceKm ?? 0;
	const type = km >= 42 ? 'marathon' : km >= 21 ? 'half marathon' : 'running race';
	const landmark = landmarks[city.toLowerCase()] ?? '';
	if (landmark) return `${cleanName} ${type} ${landmark} photo`;
	return `${cleanName} ${city} ${type} runners crowd start line photo`;
}

async function searchImages(query: string): Promise<string[]> {
	const res = await fetch('https://api.tavily.com/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: TAVILY_KEY,
			query,
			search_depth: 'basic',
			max_results: 5,
			include_images: true
		})
	});
	if (!res.ok) return [];
	const data = await res.json() as { images?: string[] };
	return (data.images ?? []).filter((img: string) =>
		!(/logo|icon|favicon|badge|sponsor|\.svg|\.gif/i.test(img))
	);
}

async function main() {
	const rows = FORCE
		? await sql`SELECT id, name, city, distance_km FROM races`
		: await sql`SELECT id, name, city, distance_km FROM races WHERE image_url IS NULL`;
	console.log(`${FORCE ? 'Refreshing' : 'Backfilling'} images for ${rows.length} races\n`);

	for (const row of rows) {
		const query = buildQuery(row.name, row.city, row.distance_km);
		console.log(`🔍 ${row.name}: "${query}"`);
		const images = await searchImages(query);
		if (images.length > 0) {
			await sql`UPDATE races SET image_url = ${images[0]} WHERE id = ${row.id}`;
			console.log(`   ✓ ${images[0]}\n`);
		} else {
			console.log(`   ✗ no image found\n`);
		}
		// 1s delay between requests
		await new Promise(r => setTimeout(r, 1000));
	}

	await sql.end();
	console.log('Done!');
}

main().catch(console.error);
