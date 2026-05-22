import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null };

	// Fetch full user row so we have role + isBlocked
	const dbUser = await db.query.user.findFirst({ where: eq(user.id, locals.user.id) });

	if (!dbUser || dbUser.isBlocked) return { user: null };

	return {
		user: {
			id: dbUser.id,
			name: dbUser.name,
			email: dbUser.email,
			role: dbUser.role
		}
	};
};
