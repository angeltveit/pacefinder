import { defineConfig } from 'drizzle-kit';

if (!process.env.DB_CONNECTION) throw new Error('DB_CONNECTION is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DB_CONNECTION },
	verbose: true,
	strict: true
});

