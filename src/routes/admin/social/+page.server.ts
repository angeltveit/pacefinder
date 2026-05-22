import { db } from '$lib/server/db';
import { socialAccounts } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const accounts = await db.select().from(socialAccounts).orderBy(socialAccounts.createdAt);
	return { accounts };
};
