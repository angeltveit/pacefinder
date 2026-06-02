import { db } from '$lib/server/db';
import { userFeatureFlags } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Developer-defined feature flags. Add new flags here; they appear automatically
 * in the admin user list with a per-user toggle. Absence of a DB row = disabled.
 */
export const FEATURE_FLAGS = [
	{
		key: 'ai_coach',
		label: 'Interactive AI coach',
		description: 'Shows a chat coach at the top of the home feed that can search and add races.'
	}
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];

export function isKnownFlag(flag: string): flag is FeatureFlagKey {
	return FEATURE_FLAGS.some((f) => f.key === flag);
}

/** Returns a map of every known flag → enabled for the given user. */
export async function getUserFlags(userId: string): Promise<Record<FeatureFlagKey, boolean>> {
	const rows = await db
		.select({ flag: userFeatureFlags.flag, enabled: userFeatureFlags.enabled })
		.from(userFeatureFlags)
		.where(eq(userFeatureFlags.userId, userId));

	const enabled = new Map(rows.map((r) => [r.flag, r.enabled]));
	const result = {} as Record<FeatureFlagKey, boolean>;
	for (const f of FEATURE_FLAGS) result[f.key] = enabled.get(f.key) ?? false;
	return result;
}

/** Whether a single flag is enabled for a user. */
export async function isFeatureEnabled(userId: string, flag: FeatureFlagKey): Promise<boolean> {
	const row = await db.query.userFeatureFlags.findFirst({
		where: and(eq(userFeatureFlags.userId, userId), eq(userFeatureFlags.flag, flag))
	});
	return row?.enabled ?? false;
}

/** Enable/disable a flag for a user (upsert). */
export async function setUserFlag(
	userId: string,
	flag: FeatureFlagKey,
	enabled: boolean
): Promise<void> {
	await db
		.insert(userFeatureFlags)
		.values({ userId, flag, enabled })
		.onConflictDoUpdate({
			target: [userFeatureFlags.userId, userFeatureFlags.flag],
			set: { enabled, updatedAt: new Date() }
		});
}
