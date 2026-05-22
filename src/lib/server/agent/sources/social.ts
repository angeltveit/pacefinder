import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { socialAccounts } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RawRaceLead } from '../types';

/**
 * Social media monitoring via Apify.
 * Monitors Instagram/TikTok accounts stored in the social_accounts table.
 * Gracefully returns [] if APIFY_API_KEY is not set or requests fail.
 */
export async function scrapeSocial(): Promise<RawRaceLead[]> {
	if (!env.APIFY_API_KEY) return [];

	const accounts = await db
		.select()
		.from(socialAccounts)
		.where(eq(socialAccounts.active, true));

	if (accounts.length === 0) return [];

	const leads: RawRaceLead[] = [];

	for (const account of accounts) {
		try {
			if (account.platform === 'instagram') {
				const results = await scrapeInstagramAccount(account.handle);
				leads.push(...results);
			} else if (account.platform === 'tiktok') {
				const results = await scrapeTiktokAccount(account.handle);
				leads.push(...results);
			}
		} catch {
			// non-fatal per account
		}
	}

	return leads;
}

async function scrapeInstagramAccount(handle: string): Promise<RawRaceLead[]> {
	// Apify Instagram profile scraper actor
	const runRes = await fetch(
		`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.APIFY_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				usernames: [handle],
				resultsLimit: 20
			}),
			signal: AbortSignal.timeout(30_000)
		}
	);
	if (!runRes.ok) return [];

	const run = (await runRes.json()) as { data?: { defaultDatasetId?: string } };
	const datasetId = run.data?.defaultDatasetId;
	if (!datasetId) return [];

	// Poll dataset for results
	await new Promise((r) => setTimeout(r, 5000));
	const dataRes = await fetch(
		`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_API_KEY}`,
		{ signal: AbortSignal.timeout(15_000) }
	);
	if (!dataRes.ok) return [];

	const items = (await dataRes.json()) as Array<{ caption?: string; url?: string }>;

	return items
		.filter((i) => i.caption && /løp|race|run|km|medal|maraton/i.test(i.caption))
		.map((i) => ({
			name: `@${handle}: ${i.caption!.slice(0, 80)}`,
			url: i.url ?? `https://instagram.com/${handle}`,
			description: i.caption?.slice(0, 400),
			source: `instagram:${handle}`
		}));
}

async function scrapeTiktokAccount(handle: string): Promise<RawRaceLead[]> {
	const runRes = await fetch(`https://api.apify.com/v2/acts/clockworks~tiktok-profile-scraper/runs`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.APIFY_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ profiles: [handle], resultsPerPage: 20 }),
		signal: AbortSignal.timeout(30_000)
	});
	if (!runRes.ok) return [];

	const run = (await runRes.json()) as { data?: { defaultDatasetId?: string } };
	const datasetId = run.data?.defaultDatasetId;
	if (!datasetId) return [];

	await new Promise((r) => setTimeout(r, 5000));
	const dataRes = await fetch(
		`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_API_KEY}`,
		{ signal: AbortSignal.timeout(15_000) }
	);
	if (!dataRes.ok) return [];

	const items = (await dataRes.json()) as Array<{ text?: string; webVideoUrl?: string }>;

	return items
		.filter((i) => i.text && /løp|race|run|km|medal|maraton/i.test(i.text))
		.map((i) => ({
			name: `@${handle}: ${i.text!.slice(0, 80)}`,
			url: i.webVideoUrl ?? `https://tiktok.com/@${handle}`,
			description: i.text?.slice(0, 400),
			source: `tiktok:${handle}`
		}));
}
