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
import { user } from './auth.schema';

export * from './auth.schema';

// ─── Races ────────────────────────────────────────────────────────────────────

export const races = pgTable('races', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	/** Base event name without distance suffix (e.g. "Bergen City Marathon") */
	eventName: text('event_name'),
	/** 'local' | 'norway' | 'international' */
	category: text('category').notNull(),
	distanceKm: real('distance_km'),
	location: text('location'),
	city: text('city').notNull(),
	country: text('country').notNull().default('NO'),
	raceDate: timestamp('race_date'),
	registrationUrl: text('registration_url'),
	websiteUrl: text('website_url'),
	resultsUrl: text('results_url'),
	imageUrl: text('image_url'),
	sourceUrl: text('source_url'),
	/** 'confirmed' | 'likely' | 'unclear' */
	medalStatus: text('medal_status').notNull().default('unclear'),
	/** 'open' | 'opening_soon' | 'unknown' | 'closed' */
	registrationStatus: text('registration_status').notNull().default('unknown'),
	whyItFits: text('why_it_fits'),
	rawLlmOutput: jsonb('raw_llm_output'),
	/** Deduplication key: slugified name+date+city */
	fingerprint: text('fingerprint').notNull().unique(),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow()
});

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
		raceId: text('race_id')
			.notNull()
			.references(() => races.id, { onDelete: 'cascade' }),
		/** 'interested' | 'attending' | 'following' | 'seen' | 'skip' */
		status: text('status').notNull(),
		bibNumber: text('bib_number'),
		notes: text('notes'),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [unique().on(t.userId, t.raceId)]
);

// ─── Comments ─────────────────────────────────────────────────────────────────

export const comments = pgTable('comments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	raceId: text('race_id')
		.notNull()
		.references(() => races.id, { onDelete: 'cascade' }),
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
	raceId: text('race_id').references(() => races.id, { onDelete: 'cascade' }),
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
	raceId: text('race_id')
		.notNull()
		.references(() => races.id, { onDelete: 'cascade' }),
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
