import { pgTable, text, boolean, timestamp, real, integer, jsonb } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
	// Custom fields
	role: text('role').notNull().default('member'), // 'member' | 'admin'
	city: text('city'),
	country: text('country').default('NO'),
	/** 'male' | 'female' | 'other' — used by the AI coach for personalised nicknames */
	gender: text('gender'),
	// ─── Personalization preferences ───
	/** Home coordinates for distance-based ranking */
	homeLat: real('home_lat'),
	homeLng: real('home_lng'),
	/** How far the runner will travel for a race (km) */
	travelRadiusKm: integer('travel_radius_km').default(150),
	/** Preferred distances, e.g. ["half","marathon"] */
	targetDistances: jsonb('target_distances'),
	/** 'casual' | 'improver' | 'competitive' */
	ambition: text('ambition'),
	/** Set when the user completes onboarding */
	onboardedAt: timestamp('onboarded_at'),
	isBlocked: boolean('is_blocked').notNull().default(false),
	blockedAt: timestamp('blocked_at'),
	blockedBy: text('blocked_by')
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at'),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
});
