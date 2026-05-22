import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			isBlocked: user.isBlocked,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(desc(user.createdAt));

	return {
		users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))
	};
};
