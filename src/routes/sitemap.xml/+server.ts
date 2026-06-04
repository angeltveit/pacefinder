import { db } from '$lib/server/db';
import { raceDistances } from '$lib/server/db/schema';
import { asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin;

	const distances = await db
		.select({ id: raceDistances.id, lastUpdatedAt: raceDistances.lastUpdatedAt })
		.from(raceDistances)
		.orderBy(asc(raceDistances.lastUpdatedAt));

	const staticPages = [
		{ loc: `${origin}/`, changefreq: 'daily', priority: '1.0' },
		{ loc: `${origin}/races`, changefreq: 'daily', priority: '0.9' }
	];

	const racePages = distances.map((d) => ({
		loc: `${origin}/races/${d.id}`,
		lastmod: d.lastUpdatedAt.toISOString().split('T')[0],
		changefreq: 'weekly',
		priority: '0.7'
	}));

	const allPages = [
		...staticPages.map((p) => `
	<url>
		<loc>${p.loc}</loc>
		<changefreq>${p.changefreq}</changefreq>
		<priority>${p.priority}</priority>
	</url>`),
		...racePages.map((p) => `
	<url>
		<loc>${p.loc}</loc>
		<lastmod>${p.lastmod}</lastmod>
		<changefreq>${p.changefreq}</changefreq>
		<priority>${p.priority}</priority>
	</url>`)
	].join('');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${allPages}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'public, max-age=3600, s-maxage=86400'
		}
	});
};
