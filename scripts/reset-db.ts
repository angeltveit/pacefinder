/**
 * Dev reset: drops all tables, recreates schema via drizzle-kit push, seeds admin user.
 *
 * Run:
 *   node_modules/.bin/tsx scripts/reset-db.ts
 *
 * Admin credentials after reset:  admin@local.dev / admin1234
 */

import postgres from 'postgres';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Load .env ─────────────────────────────────────────────────────────────────

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
	for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
		if (!process.env[key]) process.env[key] = val;
	}
}

const DB_CONNECTION = process.env.DB_CONNECTION;
if (!DB_CONNECTION) throw new Error('DB_CONNECTION env var is required');
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET env var is required');

// ── Drop all tables ───────────────────────────────────────────────────────────

console.log('Dropping all tables…');
const sql = postgres(DB_CONNECTION);

// Order matters for FKs, but CASCADE handles it anyway
const tables = [
	'race_results',
	'notifications',
	'race_user_status',
	'comments',
	'race_distances',
	'race_editions',
	'race_series',
	'agent_runs',
	'social_accounts',
	'settings',
	'session',
	'account',
	'verification',
	'user',
	// legacy — may or may not exist
	'races',
];

for (const table of tables) {
	await sql`DROP TABLE IF EXISTS ${sql(table)} CASCADE`;
	console.log(`  ✓ dropped ${table}`);
}
await sql.end();

// ── Recreate schema ───────────────────────────────────────────────────────────

console.log('\nApplying schema (drizzle-kit push)…');
child_process.execSync('node_modules/.bin/drizzle-kit push', {
	cwd: root,
	stdio: 'inherit',
	env: process.env,
});

// ── Seed admin user ───────────────────────────────────────────────────────────

console.log('\nSeeding admin user…');

const client = postgres(DB_CONNECTION);

// Inline the tables better-auth needs (avoids SvelteKit path-alias issues)
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
	blockedBy: text('blocked_by'),
});
const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id').notNull(),
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
	updatedAt: timestamp('updated_at').notNull(),
});
const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at'),
});

const db = drizzle(client, { schema: { user, session, account, verification } });

const auth = betterAuth({
	baseURL: process.env.ORIGIN ?? 'http://localhost:5173',
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			role: { type: 'string', required: true, defaultValue: 'member', input: false },
			isBlocked: { type: 'boolean', required: true, defaultValue: false, input: false },
		},
	},
});

await auth.api.signUpEmail({
	body: { email: 'admin@local.dev', password: 'admin1234', name: 'Admin' },
});
await client`UPDATE "user" SET role = 'admin' WHERE email = 'admin@local.dev'`;
await client.end();

console.log('\n✓ Done. Admin: admin@local.dev / admin1234');
