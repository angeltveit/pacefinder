/**
 * Migration: flat races table → race_series / race_editions / race_distances
 *
 * Run BEFORE applying the new Drizzle schema:
 *   npx tsx scripts/migrate-to-hierarchy.ts
 *
 * What this script does:
 *  1. Creates the three new tables (race_series, race_editions, race_distances)
 *     if they don't exist yet.
 *  2. Reads all rows from the old `races` table.
 *  3. Groups them into series (by event_name + city) and editions (by + year).
 *  4. Inserts series → editions → distances, PRESERVING the old race.id as
 *     race_distances.id so that /races/[id] URLs keep working.
 *  5. Migrates FK columns in race_user_status, comments, notifications, race_results:
 *       race_id → distance_id (with the preserved IDs the mapping is 1-to-1).
 *  6. Drops the old `races` table.
 *
 * After running this script, run `npm run db:push` (or `db:migrate`) to
 * sync the Drizzle schema with the database.
 */

import postgres from 'postgres';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load .env from project root
// ---------------------------------------------------------------------------

function loadEnv() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const envPath = path.join(root, '.env');
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq === -1) continue;
		const k = t.slice(0, eq).trim();
		const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
		if (!(k in process.env)) process.env[k] = v;
	}
}
loadEnv();

const DB_CONNECTION = process.env.DB_CONNECTION;
if (!DB_CONNECTION) {
	console.error('DB_CONNECTION env var is required');
	process.exit(1);
}

const sql = postgres(DB_CONNECTION);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[æ]/g, 'ae')
		.replace(/[ø]/g, 'oe')
		.replace(/[å]/g, 'aa')
		.replace(/[^a-z0-9|]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function makeSeriesFingerprint(eventName: string, city: string): string {
	return slugify(`${eventName}|${city}`);
}

function makeEditionFingerprint(eventName: string, city: string, year: number | null): string {
	return slugify(`${eventName}|${city}|${year ?? 'nodate'}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('=== PaceFinder hierarchy migration ===\n');

	// ── Step 1: Create new tables if they don't exist ──────────────────────

	console.log('Step 1: Creating new tables…');

	await sql`
		CREATE TABLE IF NOT EXISTS race_series (
			id            text PRIMARY KEY,
			name          text NOT NULL,
			category      text NOT NULL,
			city          text NOT NULL,
			country       text NOT NULL DEFAULT 'NO',
			website_url   text,
			image_url     text,
			why_it_fits   text,
			series_fingerprint text NOT NULL UNIQUE,
			first_seen_at timestamp NOT NULL DEFAULT now(),
			last_updated_at timestamp NOT NULL DEFAULT now()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS race_editions (
			id                  text PRIMARY KEY,
			series_id           text NOT NULL REFERENCES race_series(id) ON DELETE CASCADE,
			year                integer,
			race_date           timestamp,
			location            text,
			registration_status text NOT NULL DEFAULT 'unknown',
			website_url         text,
			source_url          text,
			raw_llm_output      jsonb,
			edition_fingerprint text NOT NULL UNIQUE,
			first_seen_at       timestamp NOT NULL DEFAULT now(),
			last_updated_at     timestamp NOT NULL DEFAULT now()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS race_distances (
			id               text PRIMARY KEY,
			edition_id       text NOT NULL REFERENCES race_editions(id) ON DELETE CASCADE,
			name             text NOT NULL,
			distance_km      real,
			registration_url text,
			results_url      text,
			medal_status     text NOT NULL DEFAULT 'unclear',
			first_seen_at    timestamp NOT NULL DEFAULT now(),
			last_updated_at  timestamp NOT NULL DEFAULT now()
		)
	`;

	console.log('  ✓ Tables created (or already existed)\n');

	// ── Step 2: Read old races table ───────────────────────────────────────

	console.log('Step 2: Reading old races table…');

	// Check if old table exists
	const tableCheck = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_name = 'races' AND table_schema = 'public'
		) AS exists
	`;

	if (!tableCheck[0].exists) {
		console.log('  races table not found — nothing to migrate.\n');
		await finalizeFkColumns();
		await sql.end();
		return;
	}

	const oldRaces = await sql<{
		id: string;
		name: string;
		event_name: string | null;
		category: string;
		distance_km: number | null;
		location: string | null;
		city: string;
		country: string;
		race_date: Date | null;
		registration_url: string | null;
		website_url: string | null;
		results_url: string | null;
		image_url: string | null;
		source_url: string | null;
		medal_status: string;
		registration_status: string;
		why_it_fits: string | null;
		raw_llm_output: unknown;
		fingerprint: string;
		first_seen_at: Date;
		last_updated_at: Date;
	}[]>`SELECT * FROM races ORDER BY first_seen_at`;

	console.log(`  Found ${oldRaces.length} rows to migrate.\n`);

	if (oldRaces.length === 0) {
		await finalizeFkColumns();
		await sql.end();
		return;
	}

	// ── Step 3: Build hierarchy and upsert ────────────────────────────────

	console.log('Step 3: Building series/editions/distances…');

	// Series map: seriesFingerprint → series id
	const seriesMap = new Map<string, string>();
	// Edition map: editionFingerprint → edition id
	const editionMap = new Map<string, string>();

	let newSeries = 0;
	let newEditions = 0;
	let newDistances = 0;

	for (const row of oldRaces) {
		const eventName = row.event_name ?? row.name;
		const year = row.race_date ? new Date(row.race_date).getFullYear() : null;

		const sf = makeSeriesFingerprint(eventName, row.city);
		const ef = makeEditionFingerprint(eventName, row.city, year);

		// ── Upsert series ────────────────────────────────────────────────

		let seriesId = seriesMap.get(sf);

		if (!seriesId) {
			// Check DB
			const existing = await sql`
				SELECT id FROM race_series WHERE series_fingerprint = ${sf}
			`;
			if (existing.length > 0) {
				seriesId = existing[0].id as string;
			} else {
				seriesId = crypto.randomUUID();
				await sql`
					INSERT INTO race_series
						(id, name, category, city, country, website_url, image_url, why_it_fits,
						 series_fingerprint, first_seen_at, last_updated_at)
					VALUES
						(${seriesId}, ${eventName}, ${row.category}, ${row.city}, ${row.country},
						 ${row.website_url}, ${row.image_url}, ${row.why_it_fits},
						 ${sf}, ${row.first_seen_at}, ${row.last_updated_at})
					ON CONFLICT (series_fingerprint) DO NOTHING
				`;
				newSeries++;
			}
			seriesMap.set(sf, seriesId);
		} else {
			// Update with better data if we have it
			await sql`
				UPDATE race_series SET
					website_url   = COALESCE(website_url, ${row.website_url}),
					image_url     = COALESCE(image_url, ${row.image_url}),
					why_it_fits   = COALESCE(why_it_fits, ${row.why_it_fits}),
					last_updated_at = GREATEST(last_updated_at, ${row.last_updated_at})
				WHERE id = ${seriesId}
			`;
		}

		// ── Upsert edition ───────────────────────────────────────────────

		let editionId = editionMap.get(ef);

		if (!editionId) {
			const existing = await sql`
				SELECT id FROM race_editions WHERE edition_fingerprint = ${ef}
			`;
			if (existing.length > 0) {
				editionId = existing[0].id as string;
			} else {
				editionId = crypto.randomUUID();
				await sql`
					INSERT INTO race_editions
						(id, series_id, year, race_date, location, registration_status,
						 website_url, source_url, raw_llm_output,
						 edition_fingerprint, first_seen_at, last_updated_at)
					VALUES
						(${editionId}, ${seriesId}, ${year}, ${row.race_date}, ${row.location},
						 ${row.registration_status}, ${row.website_url}, ${row.source_url},
						 ${row.raw_llm_output as string}, ${ef},
						 ${row.first_seen_at}, ${row.last_updated_at})
					ON CONFLICT (edition_fingerprint) DO NOTHING
				`;
				newEditions++;
			}
			editionMap.set(ef, editionId);
		} else {
			await sql`
				UPDATE race_editions SET
					registration_status = CASE
						WHEN registration_status = 'unknown' THEN ${row.registration_status}
						ELSE registration_status
					END,
					race_date     = COALESCE(race_date, ${row.race_date}),
					website_url   = COALESCE(website_url, ${row.website_url}),
					last_updated_at = GREATEST(last_updated_at, ${row.last_updated_at})
				WHERE id = ${editionId}
			`;
		}

		// ── Upsert distance (preserve original ID) ───────────────────────

		const existingDist = await sql`
			SELECT id FROM race_distances WHERE id = ${row.id}
		`;
		if (existingDist.length === 0) {
			await sql`
				INSERT INTO race_distances
					(id, edition_id, name, distance_km, registration_url, results_url,
					 medal_status, first_seen_at, last_updated_at)
				VALUES
					(${row.id}, ${editionId}, ${row.name}, ${row.distance_km},
					 ${row.registration_url}, ${row.results_url}, ${row.medal_status},
					 ${row.first_seen_at}, ${row.last_updated_at})
			`;
			newDistances++;
		}
	}

	console.log(`  ✓ ${newSeries} series, ${newEditions} editions, ${newDistances} distances created.\n`);

	// ── Step 4: Migrate FK columns ────────────────────────────────────────

	await finalizeFkColumns();

	// ── Step 5: Drop old races table ──────────────────────────────────────

	console.log('Step 5: Dropping old races table…');
	await sql`DROP TABLE IF EXISTS races CASCADE`;
	console.log('  ✓ races table dropped.\n');

	console.log('=== Migration complete ===');
	console.log('Run `npm run db:push` to sync the Drizzle schema.\n');

	await sql.end();
}

// ---------------------------------------------------------------------------
// FK column migration helpers
// ---------------------------------------------------------------------------

async function finalizeFkColumns() {
	console.log('Step 4: Migrating FK columns (race_id → distance_id)…');

	// race_user_status
	await migrateColumn(
		'race_user_status', 'race_id', 'distance_id',
		'race_distances', 'distance_id TEXT REFERENCES race_distances(id) ON DELETE CASCADE'
	);

	// comments
	await migrateColumn(
		'comments', 'race_id', 'distance_id',
		'race_distances', 'distance_id TEXT REFERENCES race_distances(id) ON DELETE CASCADE'
	);

	// notifications (nullable)
	await migrateColumn(
		'notifications', 'race_id', 'distance_id',
		'race_distances', 'distance_id TEXT REFERENCES race_distances(id) ON DELETE SET NULL',
		true
	);

	// race_results
	await migrateColumn(
		'race_results', 'race_id', 'distance_id',
		'race_distances', 'distance_id TEXT REFERENCES race_distances(id) ON DELETE CASCADE'
	);

	console.log('  ✓ FK columns migrated.\n');
}

async function migrateColumn(
	tableName: string,
	oldCol: string,
	newCol: string,
	refTable: string,
	colDef: string,
	nullable = false
) {
	// Check if table exists
	const tableExists = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_name = ${tableName} AND table_schema = 'public'
		) AS exists
	`;
	if (!tableExists[0].exists) return;

	// Check if old column exists
	const oldColExists = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = ${tableName} AND column_name = ${oldCol} AND table_schema = 'public'
		) AS exists
	`;
	// Check if new column already exists
	const newColExists = await sql`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = ${tableName} AND column_name = ${newCol} AND table_schema = 'public'
		) AS exists
	`;

	if (newColExists[0].exists) {
		console.log(`  ${tableName}.${newCol} already exists, skipping.`);
		return;
	}

	if (oldColExists[0].exists) {
		// Add new column
		await sql.unsafe(`ALTER TABLE ${tableName} ADD COLUMN ${colDef}`);
		// Copy data
		await sql.unsafe(`UPDATE ${tableName} SET ${newCol} = ${oldCol}`);
		if (!nullable) {
			// Drop FK constraint on old column first, then the column
			await sql.unsafe(`
				DO $$ DECLARE r RECORD;
				BEGIN
					FOR r IN SELECT constraint_name FROM information_schema.table_constraints tc
						JOIN information_schema.key_column_usage kcu
							ON tc.constraint_name = kcu.constraint_name
						WHERE tc.table_name = '${tableName}' AND kcu.column_name = '${oldCol}'
						  AND tc.constraint_type = 'FOREIGN KEY'
					LOOP
						EXECUTE 'ALTER TABLE ${tableName} DROP CONSTRAINT ' || quote_ident(r.constraint_name);
					END LOOP;
				END $$
			`);
			await sql.unsafe(`ALTER TABLE ${tableName} DROP COLUMN ${oldCol}`);
		}
		console.log(`  ${tableName}: ${oldCol} → ${newCol}`);
	} else {
		console.log(`  ${tableName}.${oldCol} not found, skipping.`);
	}
}

// ---------------------------------------------------------------------------

main().catch((err) => {
	console.error('Migration failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
