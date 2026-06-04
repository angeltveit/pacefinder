import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// Prefer an explicit PUBLIC_SITE_URL env var so OG/canonical URLs are correct
	// behind reverse proxies where url.origin may reflect the internal origin.
	const origin = (env.PUBLIC_SITE_URL ?? url.origin).replace(/\/$/, '');
	if (!locals.user) return { user: null, origin };

	// Fetch full user row so we have role + isBlocked
	const dbUser = await db.query.user.findFirst({ where: eq(user.id, locals.user.id) });

	if (!dbUser || dbUser.isBlocked) return { user: null, origin };

	return {
		origin,
		user: {
			id: dbUser.id,
			name: dbUser.name,
			email: dbUser.email,
			role: dbUser.role
		}
	};
};
