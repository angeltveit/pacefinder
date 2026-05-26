/**
 * Quick test: scrape results for Bergen City Marathon – Marathon
 * Usage: npx tsx scripts/test-results.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import * as cheerio from 'cheerio';

const { races, raceResults } = schema;
const client = postgres(process.env.DB_CONNECTION ?? 'postgresql://localhost:5432/race_lookup');
const db = drizzle(client, { schema });

const RACE_ID = '26a08baa-b3c7-4891-91cd-6ef1a2332a1a'; // Bergen City Marathon – Half Marathon

function log(msg: string) {
	console.log(msg);
}

async function fetchPage(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaceFinder/1.0)' },
			redirect: 'follow',
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}

function extractLinksAndTables(html: string, baseUrl: string) {
	const $ = cheerio.load(html);
	const resultLinks: { text: string; href: string }[] = [];
	$('a[href]').each((_, el) => {
		const text = $(el).text().trim().toLowerCase();
		const href = $(el).attr('href') ?? '';
		if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
		if (/resultat|results?|tidtaking|timing|live.?result/i.test(text + href)) {
			let resolved: string;
			try { resolved = href.startsWith('http') ? href : new URL(href, baseUrl).href; } catch { return; }
			resultLinks.push({ text: $(el).text().trim(), href: resolved });
		}
	});
	const tables: string[] = [];
	$('table').each((_, table) => {
		const rows: string[][] = [];
		$(table).find('tr').each((_, tr) => {
			const cells: string[] = [];
			$(tr).find('th, td').each((_, cell) => { cells.push($(cell).text().trim()); });
			if (cells.length > 0) rows.push(cells);
		});
		if (rows.length >= 3 && rows[0].length >= 2) {
			tables.push(rows.map(r => r.join(' | ')).join('\n'));
		}
	});
	const gridText = $('[class*="result"], [class*="runner"], [class*="athlete"], [id*="result"]')
		.text().replace(/\s+/g, ' ').trim().slice(0, 3000);
	const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);
	return { resultLinks: resultLinks.slice(0, 10), tables: tables.slice(0, 3), gridText, pageText };
}

async function searchForResults(query: string): Promise<{ url: string; title: string }[]> {
	if (!process.env.TAVILY_API_KEY) return [];
	const res = await fetch('https://api.tavily.com/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5 }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) return [];
	const data = await res.json() as { results?: { url: string; title: string }[] };
	return (data.results ?? []).filter(r => /resultat|result|timing|eqtiming|frires|live/i.test(r.url + r.title));
}

async function main() {
	const race = await db.query.races.findFirst({ where: eq(races.id, RACE_ID) });
	if (!race) { console.error('Race not found'); process.exit(1); }
	
	log(`Testing results scraper for: ${race.name}`);
	log(`Website: ${race.websiteUrl}`);
	log(`Results URL: ${race.resultsUrl ?? '(none)'}`);
	log('');

	// Step 1: Check official website
	let resultsUrl = race.resultsUrl;
	let html: string | null = null;

	if (resultsUrl) {
		log(`Step 1: Trying known results URL: ${resultsUrl}`);
		html = await fetchPage(resultsUrl);
		if (html) log(`  Got ${html.length} bytes`);
		else log('  Failed to fetch');
	}

	if (!html && race.websiteUrl) {
		log(`Step 2: Checking official website: ${race.websiteUrl}`);
		const siteHtml = await fetchPage(race.websiteUrl);
		if (siteHtml) {
			log(`  Got ${siteHtml.length} bytes from site`);
			const { resultLinks } = extractLinksAndTables(siteHtml, race.websiteUrl);
			log(`  Found ${resultLinks.length} results links:`);
			for (const link of resultLinks.slice(0, 5)) {
				log(`    - "${link.text}" → ${link.href}`);
			}
			if (resultLinks.length > 0) {
				resultsUrl = resultLinks[0].href;
				html = await fetchPage(resultsUrl);
				if (html) log(`  Got ${html.length} bytes from results page`);
			}
		} else {
			log('  Failed to fetch website');
		}
	}

	if (!html) {
		const year = race.raceDate ? new Date(race.raceDate).getFullYear() : 2025;
		const query = `${race.name} resultater ${year} eqtiming OR frires OR results`;
		log(`Step 3: Searching: "${query}"`);
		const results = await searchForResults(query);
		log(`  Got ${results.length} results:`);
		for (const r of results) log(`    - ${r.title} → ${r.url}`);
		if (results.length > 0) {
			resultsUrl = results[0].url;
			html = await fetchPage(resultsUrl);
			if (html) log(`  Got ${html.length} bytes from search result`);
		}
	}

	if (!html) {
		log('\nNo results page found. Done.');
		process.exit(0);
	}

	log(`\nParsing results from: ${resultsUrl}`);
	const { tables, gridText, pageText } = extractLinksAndTables(html, resultsUrl!);
	log(`  Tables: ${tables.length}, Grid text: ${gridText.length} chars`);
	
	if (tables.length > 0) {
		log(`\nFirst table preview (first 10 rows):`);
		const lines = tables[0].split('\n').slice(0, 10);
		for (const line of lines) log(`  ${line}`);
	} else if (gridText) {
		log(`\nGrid text preview: ${gridText.slice(0, 500)}`);
	} else {
		log(`\nPage text (timing data check): ${pageText.slice(0, 500)}`);
	}

	log('\nDone! (skipping LLM parse for this test)');
	process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
