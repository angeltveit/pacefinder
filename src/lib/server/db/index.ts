import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DB_CONNECTION) throw new Error('DB_CONNECTION is not set');

const client = postgres(env.DB_CONNECTION);

export const db = drizzle(client, { schema });

