// Dev seed: creates a default admin account (admin@local.dev / admin1234).
// Run via: npm run db:seed
// Safe to re-run — skips if the user already exists.

import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

const DB_CONNECTION = process.env.DB_CONNECTION;
if (!DB_CONNECTION) throw new Error('DB_CONNECTION is not set');

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

// Inline the tables better-auth needs so this script stays self-contained
// and avoids SvelteKit path-alias resolution issues.
const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull(),
	image: text('image'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),
	role: text('role').notNull(),
	isBlocked: boolean('is_blocked').notNull(),
	blockedAt: timestamp('blocked_at'),
	blockedBy: text('blocked_by')
});

const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id').notNull()
});

const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at'),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
});

const client = postgres(DB_CONNECTION);
const db = drizzle(client, { schema: { user, session, account, verification } });

const auth = betterAuth({
	baseURL: process.env.ORIGIN ?? 'http://localhost:5173',
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			role: { type: 'string', required: true, defaultValue: 'member', input: false },
			isBlocked: { type: 'boolean', required: true, defaultValue: false, input: false }
		}
	}
});

const ADMIN_EMAIL = 'admin@local.dev';
const ADMIN_PASSWORD = 'admin1234';

try {
	await auth.api.signUpEmail({
		body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Admin' }
	});
	await client`UPDATE "user" SET role = 'admin' WHERE email = ${ADMIN_EMAIL}`;
	console.log(`✓ Admin user created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
} catch (err: unknown) {
	const code = (err as any)?.body?.code ?? (err as any)?.code;
	if (code === 'USER_ALREADY_EXISTS') {
		console.log('Admin user already exists, skipping.');
	} else {
		throw err;
	}
} finally {
	await client.end();
}
