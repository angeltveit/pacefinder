import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const row = await db.query.settings.findFirst({
		where: and(
			eq(settings.scope, 'system'),
			eq(settings.key, 'llm_monthly_budget_usd'),
			isNull(settings.userId)
		)
	});

	const current = row ? parseFloat(row.value) : parseFloat(env.MONTHLY_LLM_BUDGET_USD ?? '10');
	const newBudget = current + 10;

	if (row) {
		await db
			.update(settings)
			.set({ value: String(newBudget) })
			.where(eq(settings.id, row.id));
	} else {
		await db
			.insert(settings)
			.values({ scope: 'system', key: 'llm_monthly_budget_usd', value: String(newBudget) });
	}

	return json({ budget: newBudget });
};
