import Redis from 'ioredis';
import { env } from '$env/dynamic/private';

// Redis is optional — all callers must handle null gracefully
let redis: Redis | null = null;

if (env.REDIS_URL) {
	redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
	redis.on('error', (err) => {
		console.warn('[redis] connection error — stats will degrade gracefully:', err.message);
	});
}

export { redis };

// ─── Stat key constants ───────────────────────────────────────────────────────

export const KEYS = {
	USERS_TOTAL: 'stats:users:total',
	USERS_NEW_24H: 'stats:users:new_24h',
	RACES_TOTAL: 'stats:races:total',
	RACES_UPCOMING: 'stats:races:upcoming',
	RACES_NEW_24H: 'stats:races:new_24h',
	TOKENS_INPUT_ALLTIME: 'stats:tokens:input:alltime',
	TOKENS_OUTPUT_ALLTIME: 'stats:tokens:output:alltime',
	TOKENS_COST_ALLTIME: 'stats:tokens:cost_usd:alltime',
	TOKENS_INPUT_TODAY: 'stats:tokens:input:today',
	TOKENS_OUTPUT_TODAY: 'stats:tokens:output:today',
	TOKENS_COST_TODAY: 'stats:tokens:cost_usd:today',
	AGENT_LAST_RUN: 'agent:last_run'
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function incrStat(key: string, by = 1): Promise<void> {
	if (!redis) return;
	try {
		await redis.incrbyfloat(key, by);
	} catch {
		// non-fatal
	}
}

export async function setStat(key: string, value: string): Promise<void> {
	if (!redis) return;
	try {
		await redis.set(key, value);
	} catch {
		// non-fatal
	}
}

export async function getStat(key: string): Promise<string | null> {
	if (!redis) return null;
	try {
		return await redis.get(key);
	} catch {
		return null;
	}
}

export async function setHash(key: string, data: Record<string, string>): Promise<void> {
	if (!redis) return;
	try {
		await redis.hset(key, data);
	} catch {
		// non-fatal
	}
}

export async function getHash(key: string): Promise<Record<string, string> | null> {
	if (!redis) return null;
	try {
		const result = await redis.hgetall(key);
		return Object.keys(result).length ? result : null;
	} catch {
		return null;
	}
}
