/**
 * One-off: deduplicate existing races in the database using LLM.
 * Run with: npx tsx scripts/dedup-races.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

const DB_URL = process.env.DB_CONNECTION || 'postgresql://localhost:5432/race_lookup';
const sql = postgres(DB_URL);

const model = createAnthropic({ apiKey: process.env.LLM_API_KEY! })('claude-sonnet-4-6');

const DEDUP_PROMPT = `You are deduplicating a list of running races from a database. Some races appear multiple times with slightly different names but are the SAME event + distance.

Rules for identifying duplicates:
- Same city + same distance (10km = 10K = 10 km, 21.1km = 21.0975km = half marathon, 42.2km = 42.195km = marathon) + clearly same event = DUPLICATE
- A race with/without a year suffix is the same race (e.g. "Berlin Marathon 2026" = "BMW Berlin Marathon 2026")
- A race with/without a sponsor prefix is the same race (e.g. "TCS New York City Marathon" = "New York City Marathon")  
- "Midnight Sun Marathon" and "Tromsø Midnight Sun Marathon" are the SAME event (same city Tromsø)
- "Bergen City Marathon – 5K" and other distances that are part of "Bergen City Milen" or "Bergen City Marathon" should be checked carefully
- Different distances of the same event are NOT duplicates (keep "Marathon" and "Half Marathon" as separate entries)
- If unsure, keep them separate

Return groups of indices that are duplicates of each other. Each group = same race, same distance.
Only include groups with 2+ items.`;

const dedupeSchema = z.object({
	duplicateGroups: z.array(
		z.object({
			indices: z.array(z.number()).describe('0-based indices of races that are duplicates'),
			keepIndex: z.number().describe('Which index to keep as the canonical entry (best name, most data)'),
			reasoning: z.string()
		})
	)
});

async function main() {
	const rows = await sql`SELECT id, name, city, distance_km, race_date::text, medal_status, website_url, image_url, registration_url FROM races ORDER BY city, name`;
	
	console.log(`Found ${rows.length} races in DB\n`);
	
	const raceList = rows.map((r, i) =>
		`[${i}] "${r.name}" — ${r.city} — ${r.distance_km ?? '?'}km — date:${r.race_date ?? '?'} — medal:${r.medal_status}`
	).join('\n');

	console.log('Sending to LLM for dedup analysis…\n');

	const { object } = await generateObject({
		model,
		system: DEDUP_PROMPT,
		prompt: raceList,
		schema: dedupeSchema
	});

	if (object.duplicateGroups.length === 0) {
		console.log('No duplicates found!');
		await sql.end();
		return;
	}

	console.log(`Found ${object.duplicateGroups.length} duplicate groups:\n`);

	for (const group of object.duplicateGroups) {
		const validIndices = group.indices.filter(i => i >= 0 && i < rows.length);
		if (validIndices.length < 2) continue;

		const keepId = rows[group.keepIndex]?.id;
		const deleteIds = validIndices
			.filter(i => i !== group.keepIndex)
			.map(i => rows[i].id);

		console.log(`  Group: ${validIndices.map(i => `"${rows[i].name}"`).join(' + ')}`);
		console.log(`  Keep: "${rows[group.keepIndex].name}" (${keepId})`);
		console.log(`  Delete: ${deleteIds.length} duplicates`);
		console.log(`  Reason: ${group.reasoning}\n`);

		// Before deleting, merge useful data into the keeper
		const keeper = rows[group.keepIndex];
		for (const idx of validIndices) {
			if (idx === group.keepIndex) continue;
			const dup = rows[idx];
			const updates: Record<string, unknown> = {};
			if (!keeper.website_url && dup.website_url) updates.website_url = dup.website_url;
			if (!keeper.image_url && dup.image_url) updates.image_url = dup.image_url;
			if (!keeper.registration_url && dup.registration_url) updates.registration_url = dup.registration_url;
			if (!keeper.race_date && dup.race_date) updates.race_date = dup.race_date;
			if (dup.medal_status === 'confirmed' && keeper.medal_status !== 'confirmed') updates.medal_status = 'confirmed';
			
			if (Object.keys(updates).length > 0) {
				// Build dynamic update
				const setClauses = Object.entries(updates).map(([k, v]) => sql`${sql(k)} = ${v as string}`);
				await sql`UPDATE races SET ${sql.unsafe(Object.entries(updates).map(([k]) => `${k} = '${updates[k]}'`).join(', '))}, last_updated_at = now() WHERE id = ${keepId}`;
				console.log(`    Merged fields: ${Object.keys(updates).join(', ')}`);
			}
		}

		// Delete duplicates (move comments/status to keeper first)
		for (const delId of deleteIds) {
			await sql`UPDATE race_user_status SET race_id = ${keepId} WHERE race_id = ${delId} AND NOT EXISTS (SELECT 1 FROM race_user_status WHERE race_id = ${keepId} AND user_id = race_user_status.user_id)`;
			await sql`UPDATE comments SET race_id = ${keepId} WHERE race_id = ${delId}`;
			await sql`DELETE FROM race_user_status WHERE race_id = ${delId}`;
			await sql`DELETE FROM races WHERE id = ${delId}`;
		}
		console.log(`    ✓ Deleted ${deleteIds.length} duplicates\n`);
	}

	const remaining = await sql`SELECT count(*) as c FROM races`;
	console.log(`Done! ${remaining[0].c} races remaining.`);
	await sql.end();
}

main().catch(console.error);
