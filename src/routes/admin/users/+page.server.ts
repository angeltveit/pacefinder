import { db } from '$lib/server/db';
import { user, userFeatureFlags } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { FEATURE_FLAGS, type FeatureFlagKey } from '$lib/server/featureFlags';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			gender: user.gender,
			isBlocked: user.isBlocked,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(desc(user.createdAt));

	const flagRows = await db
		.select({
			userId: userFeatureFlags.userId,
			flag: userFeatureFlags.flag,
			enabled: userFeatureFlags.enabled
		})
		.from(userFeatureFlags);

	const flagsByUser = new Map<string, Record<string, boolean>>();
	for (const r of flagRows) {
		if (!flagsByUser.has(r.userId)) flagsByUser.set(r.userId, {});
		flagsByUser.get(r.userId)![r.flag] = r.enabled;
	}

	return {
		flagDefs: FEATURE_FLAGS.map((f) => ({ key: f.key, label: f.label, description: f.description })),
		users: users.map((u) => {
			const stored = flagsByUser.get(u.id) ?? {};
			const flags = {} as Record<FeatureFlagKey, boolean>;
			for (const f of FEATURE_FLAGS) flags[f.key] = stored[f.key] ?? false;
			return { ...u, createdAt: u.createdAt.toISOString(), flags };
		})
	};
};
