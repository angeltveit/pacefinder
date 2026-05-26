import {
	pgTable,
	text,
	boolean,
	timestamp,
	real,
	jsonb,
	integer,
	unique
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './auth.schema';

export * from './auth.schema';

// ─── Race Series ──────────────────────────────────────────────────────────────
// The recurring brand/concept, e.g. "Bergen City Marathon" or "Vinløpet"

export const raceSeries = pgTable('race_series', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	/** Clean event name without year or distance, e.g. "Bergen City Marathon" */
	name: text('name').notNull(),
	/** 'local' | 'norway' | 'international' */
	category: text('category').notNull(),
	city: text('city').notNull(),
	country: text('country').notNull().default('NO'),
	/** Series-level website (may be overridden per edition) */
	websiteUrl: text('website_url'),
	imageUrl: text('image_url'),
	whyItFits: text('why_it_fits'),
	/** Deduplication key: slugified name+city */
	seriesFingerprint: text('series_fingerprint').notNull().unique(),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow()
});

// ─── Race Editions ────────────────────────────────────────────────────────────
// A specific occurrence/year, e.g. "Bergen City Marathon 2026"

export const raceEditions = pgTable('race_editions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	seriesId: text('series_id')
		.notNull()
		.references(() => raceSeries.id, { onDelete: 'cascade' }),
	year: integer('year'),
	raceDate: timestamp('race_date'),
	location: text('location'),
	/** 'open' | 'opening_soon' | 'unknown' | 'closed' */
	registrationStatus: text('registration_status').notNull().default('unknown'),
	/** Edition-specific website URL (overrides series websiteUrl when set) */
	websiteUrl: text('website_url'),
	sourceUrl: text('source_url'),
	rawLlmOutput: jsonb('raw_llm_output'),
	/** Deduplication key: slugified eventName+city+year */
	editionFingerprint: text('edition_fingerprint').notNull().unique(),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow()
});

// ─── Race Distances ───────────────────────────────────────────────────────────
// A registerable option within an edition: 5K, Half Marathon, Marathon, etc.
// IDs are preserved from the old races table for URL stability.

export const raceDistances = pgTable('race_distances', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	editionId: text('edition_id')
		.notNull()
		.references(() => raceEditions.id, { onDelete: 'cascade' }),
	/** Full name including distance suffix, e.g. "Bergen City Marathon – 10K" */
	name: text('name').notNull(),
	distanceKm: real('distance_km'),
	registrationUrl: text('registration_url'),
	resultsUrl: text('results_url'),
	/** 'confirmed' | 'likely' | 'unclear' */
	medalStatus: text('medal_status').notNull().default('unclear'),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow()
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const raceSeriesRelations = relations(raceSeries, ({ many }) => ({
	editions: many(raceEditions)
}));

export const raceEditionsRelations = relations(raceEditions, ({ one, many }) => ({
	series: one(raceSeries, { fields: [raceEditions.seriesId], references: [raceSeries.id] }),
	distances: many(raceDistances)
}));

export const raceDistancesRelations = relations(raceDistances, ({ one, many }) => ({
	edition: one(raceEditions, { fields: [raceDistances.editionId], references: [raceEditions.id] }),
	commentsList: many(comments),
	results: many(raceResults)
}));

export const raceEditionsRelationsExtra = relations(raceEditions, ({ many }) => ({
	userStatuses: many(raceUserStatus)
}));

// ─── Per-user triage ──────────────────────────────────────────────────────────

export const raceUserStatus = pgTable(
	'race_user_status',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** References race_editions.id — one status row per user per edition */
		editionId: text('edition_id')
			.notNull()
			.references(() => raceEditions.id, { onDelete: 'cascade' }),
		/** 'interested' | 'attending' | 'following' | 'seen' | 'skip' */
		status: text('status').notNull(),
		bibNumber: text('bib_number'),
		notes: text('notes'),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [unique().on(t.userId, t.editionId)]
);

// ─── Comments ─────────────────────────────────────────────────────────────────

export const comments = pgTable('comments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	/** References race_distances.id */
	distanceId: text('distance_id')
		.notNull()
		.references(() => raceDistances.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	body: text('body').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	deletedAt: timestamp('deleted_at')
});

// ─── Agent runs ───────────────────────────────────────────────────────────────

export const agentRuns = pgTable('agent_runs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	startedAt: timestamp('started_at').notNull().defaultNow(),
	finishedAt: timestamp('finished_at'),
	/** 'running' | 'completed' | 'failed' */
	status: text('status').notNull().default('running'),
	racesScanned: integer('races_scanned').default(0),
	racesNew: integer('races_new').default(0),
	racesUpdated: integer('races_updated').default(0),
	tokensInput: integer('tokens_input').default(0),
	tokensOutput: integer('tokens_output').default(0),
	estimatedCostUsd: real('estimated_cost_usd').default(0),
	sourcesUsed: jsonb('sources_used'),
	errorLog: text('error_log')
});

// ─── Social accounts to monitor ───────────────────────────────────────────────

export const socialAccounts = pgTable('social_accounts', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	platform: text('platform').notNull(), // 'instagram' | 'tiktok'
	handle: text('handle').notNull(),
	active: boolean('active').notNull().default(true),
	addedBy: text('added_by').references(() => user.id),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

// ─── Key-value settings ───────────────────────────────────────────────────────

export const settings = pgTable(
	'settings',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/** 'user' | 'system' */
		scope: text('scope').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull()
	},
	(t) => [unique().on(t.scope, t.userId, t.key)]
);

// ─── Notifications (stub for future delivery) ─────────────────────────────────

export const notifications = pgTable('notifications', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** Optional: pin notification to a specific distance */
	distanceId: text('distance_id').references(() => raceDistances.id, { onDelete: 'cascade' }),
	type: text('type').notNull(),
	sentAt: timestamp('sent_at'),
	payload: jsonb('payload'),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

// ─── Race results / leaderboard ───────────────────────────────────────────────

export const raceResults = pgTable('race_results', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	/** References race_distances.id */
	distanceId: text('distance_id')
		.notNull()
		.references(() => raceDistances.id, { onDelete: 'cascade' }),
	position: integer('position'),
	name: text('name').notNull(),
	bibNumber: text('bib_number'),
	finishTime: text('finish_time').notNull(),
	/** Time in seconds for sorting */
	finishTimeSeconds: real('finish_time_seconds'),
	category: text('category'),
	categoryPosition: integer('category_position'),
	club: text('club'),
	scrapedAt: timestamp('scraped_at').notNull().defaultNow()
});
