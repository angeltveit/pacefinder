/**
 * Instagram Graph API scraper — standalone proof-of-concept.
 *
 * Run:
 *   npx tsx scripts/instagram/scraper.ts
 *
 * Required env vars (see .env.example):
 *   INSTAGRAM_ACCESS_TOKEN   – long-lived User or Page access token
 *   INSTAGRAM_ACCOUNT_ID     – (optional) IG user ID; auto-discovered if omitted
 *   INSTAGRAM_MAX_POSTS      – max posts to fetch (default 25)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnvFile(): void {
	const dir = path.dirname(fileURLToPath(import.meta.url));
	const envPath = path.resolve(dir, '.env');
	if (!fs.existsSync(envPath)) return;
	const content = fs.readFileSync(envPath, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
		if (!(key in process.env)) process.env[key] = value;
	}
}

loadEnvFile();

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN ?? '';
const ACCOUNT_ID_ENV = process.env.INSTAGRAM_ACCOUNT_ID ?? '';
const MAX_POSTS = Math.min(Math.max(parseInt(process.env.INSTAGRAM_MAX_POSTS ?? '25', 10), 1), 200);

if (!ACCESS_TOKEN) {
	console.error('Error: INSTAGRAM_ACCESS_TOKEN is required.');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// API constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://graph.instagram.com/v21.0';
const MEDIA_FIELDS = 'id,caption,timestamp,permalink,media_type,media_url,username';
const PAGE_SIZE = 25; // max per Instagram Graph API page
const REQUEST_DELAY_MS = 300; // be polite – 3+ req/s well under 200/hr limit

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';

interface IGMedia {
	id: string;
	caption?: string;
	timestamp: string;
	permalink: string;
	media_type: MediaType;
	media_url?: string;
	username?: string;
}

interface IGPaging {
	cursors?: { before: string; after: string };
	next?: string;
}

interface IGMediaPage {
	data: IGMedia[];
	paging?: IGPaging;
}

interface IGAccount {
	id: string;
	username: string;
	account_type?: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

interface ExtractedEvent {
	name: string | null;
	city: string | null;
	date: string | null;
	distance: string | null;
	registration_hint: string | null;
	medal_hint: string | null;
	timing_hint: string | null;
	confidence: number;
	missing_fields: string[];
}

interface NormalizedPost {
	id: string;
	caption: string | null;
	timestamp: string;
	permalink: string;
	media_type: MediaType;
	media_url: string | null;
	race_candidate: boolean;
	extracted_event: ExtractedEvent;
}

interface ScraperOutput {
	source: 'instagram';
	account: {
		id: string;
		username: string;
		type: 'instagram';
	};
	posts: NormalizedPost[];
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
	endpoint: string,
	params: Record<string, string> = {}
): Promise<T> {
	const url = new URL(endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`);
	url.searchParams.set('access_token', ACCESS_TOKEN);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	const res = await fetch(url.toString(), {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});

	if (!res.ok) {
		let errMsg = `HTTP ${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { error?: { message?: string; code?: number } };
			if (body.error?.message) errMsg += ` — ${body.error.message} (code ${body.error.code})`;
		} catch {
			// ignore parse failure
		}
		throw new Error(errMsg);
	}

	return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Account discovery
// ---------------------------------------------------------------------------

async function resolveAccountId(): Promise<IGAccount> {
	if (ACCOUNT_ID_ENV) {
		const account = await apiFetch<IGAccount>(`/${ACCOUNT_ID_ENV}`, {
			fields: 'id,username,account_type'
		});
		return account;
	}
	// Discover via /me endpoint (works for User tokens)
	const account = await apiFetch<IGAccount>('/me', { fields: 'id,username,account_type' });
	return account;
}

// ---------------------------------------------------------------------------
// Paginated media fetcher
// ---------------------------------------------------------------------------

async function fetchAllMedia(accountId: string, limit: number): Promise<IGMedia[]> {
	const results: IGMedia[] = [];
	let after: string | undefined;
	let pageNum = 0;

	while (results.length < limit) {
		const remaining = limit - results.length;
		const pageSize = Math.min(PAGE_SIZE, remaining);

		const params: Record<string, string> = {
			fields: MEDIA_FIELDS,
			limit: String(pageSize)
		};
		if (after) params['after'] = after;

		pageNum++;
		process.stderr.write(`Fetching page ${pageNum} (${results.length}/${limit} so far)…\n`);

		const page = await apiFetch<IGMediaPage>(`/${accountId}/media`, params);
		const items = page.data ?? [];
		results.push(...items);

		after = page.paging?.cursors?.after;
		if (!page.paging?.next || !after || items.length === 0) break;

		await sleep(REQUEST_DELAY_MS);
	}

	return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Race-event classifier
// ---------------------------------------------------------------------------

// Norwegian + English keyword lists
const RACE_KEYWORDS = [
	// Distance keywords
	/\b\d+\s*km\b/i,
	/\b\d+\s*k\b/i,
	/\bmaraton\b/i,
	/\bmarathon\b/i,
	/\bhalvmaraton\b/i,
	/\bhalf[\s-]?marathon\b/i,
	// Event type
	/\bløp\b/i,
	/\brace\b/i,
	/\btrial\b/i,
	/\bchampionship\b/i,
	/\bmesterskap\b/i,
	/\bstafett\b/i,
	/\brelay\b/i,
	/\btrail\b/i,
	/\bultraløp\b/i,
	/\bultra\b/i,
	/\bsprint\b/i,
	/\btriathlon\b/i,
	/\bdistance\b/i,
	// Registration
	/\bpåmelding\b/i,
	/\bregistrer\b/i,
	/\bregister\b/i,
	/\bsign[\s-]?up\b/i,
	/\blink in bio\b/i,
	// Medal / finish
	/\bmedalje\b/i,
	/\bmedal\b/i,
	/\bfinisher\b/i,
	/\bfinish\b/i,
	/\bpremie\b/i,
	// Timing
	/\btid\b/i,
	/\btiming\b/i,
	/\bchiptime\b/i,
	/\bresultat\b/i,
	/\bresult\b/i
];

// Patterns for extracting specific facts
const DISTANCE_RE = /\b(\d+(?:[.,]\d+)?)\s*(km|k|mil|miles?|m(?=[\s,]))\b/gi;
const DATE_RE =
	/\b(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\b|\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|mai|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|okt|oct(?:ober)?|nov(?:ember)?|des|dec(?:ember)?)\s+(\d{2,4})\b/gi;
const CITY_CLUES_RE =
	/\b(?:i|in|at|ved|på)\s+([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?)\b/g;
const REG_RE = /påmelding|registrer|register|sign[\s-]?up|link in bio/i;
const MEDAL_RE = /medalje|medal|finisher/i;
const TIMING_RE = /timing|chiptime|tid\b|chip|resultat|result/i;

const CONFIDENCE_PER_SIGNAL = 0.15;

function extractEvent(caption: string): ExtractedEvent {
	const event: ExtractedEvent = {
		name: null,
		city: null,
		date: null,
		distance: null,
		registration_hint: null,
		medal_hint: null,
		timing_hint: null,
		confidence: 0,
		missing_fields: []
	};

	// Distance
	const distMatch = [...caption.matchAll(DISTANCE_RE)];
	if (distMatch.length > 0) {
		event.distance = distMatch.map((m) => `${m[1]}${m[2]}`).join(', ');
		event.confidence += CONFIDENCE_PER_SIGNAL;
	}

	// Date
	const dateMatches = [...caption.matchAll(DATE_RE)];
	if (dateMatches.length > 0) {
		event.date = dateMatches[0][0].trim();
		event.confidence += CONFIDENCE_PER_SIGNAL;
	}

	// City (heuristic: word following preposition)
	const cityMatches = [...caption.matchAll(CITY_CLUES_RE)];
	if (cityMatches.length > 0) {
		event.city = cityMatches[0][1];
		event.confidence += CONFIDENCE_PER_SIGNAL * 0.5;
	}

	// Registration hint
	if (REG_RE.test(caption)) {
		event.registration_hint = caption.match(REG_RE)?.[0] ?? null;
		event.confidence += CONFIDENCE_PER_SIGNAL * 0.5;
	}

	// Medal hint
	if (MEDAL_RE.test(caption)) {
		event.medal_hint = caption.match(MEDAL_RE)?.[0] ?? null;
		event.confidence += CONFIDENCE_PER_SIGNAL * 0.5;
	}

	// Timing hint
	if (TIMING_RE.test(caption)) {
		event.timing_hint = caption.match(TIMING_RE)?.[0] ?? null;
		event.confidence += CONFIDENCE_PER_SIGNAL * 0.5;
	}

	// Derive a name guess: first line or first 80 chars of caption
	const firstLine = caption.split('\n')[0].trim();
	event.name = firstLine.length > 0 ? firstLine.slice(0, 100) : null;
	if (event.name) event.confidence += CONFIDENCE_PER_SIGNAL * 0.5;

	// Missing fields
	const required: (keyof ExtractedEvent)[] = ['date', 'distance', 'city', 'name'];
	event.missing_fields = required.filter((f) => event[f] === null);

	event.confidence = Math.min(parseFloat(event.confidence.toFixed(2)), 1.0);
	return event;
}

function isRaceCandidate(caption: string): boolean {
	return RACE_KEYWORDS.some((re) => re.test(caption));
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

function normalizePost(media: IGMedia): NormalizedPost {
	const caption = media.caption ?? null;
	const raceCandidate = caption !== null && isRaceCandidate(caption);
	const extractedEvent = raceCandidate && caption ? extractEvent(caption) : blankEvent();

	return {
		id: media.id,
		caption,
		timestamp: media.timestamp,
		permalink: media.permalink,
		media_type: media.media_type,
		media_url: media.media_url ?? null,
		race_candidate: raceCandidate,
		extracted_event: extractedEvent
	};
}

function blankEvent(): ExtractedEvent {
	return {
		name: null,
		city: null,
		date: null,
		distance: null,
		registration_hint: null,
		medal_hint: null,
		timing_hint: null,
		confidence: 0.0,
		missing_fields: ['name', 'date', 'distance', 'city']
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	process.stderr.write('Resolving Instagram account…\n');
	const account = await resolveAccountId();
	process.stderr.write(`Account: @${account.username} (id=${account.id})\n`);

	process.stderr.write(`Fetching up to ${MAX_POSTS} posts…\n`);
	const media = await fetchAllMedia(account.id, MAX_POSTS);
	process.stderr.write(`Fetched ${media.length} posts.\n`);

	const posts = media.map(normalizePost);
	const candidateCount = posts.filter((p) => p.race_candidate).length;
	process.stderr.write(`Race candidates: ${candidateCount}/${posts.length}\n`);

	const output: ScraperOutput = {
		source: 'instagram',
		account: {
			id: account.id,
			username: account.username,
			type: 'instagram'
		},
		posts
	};

	// JSON to stdout; progress/info to stderr
	process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch((err) => {
	console.error('Fatal error:', err instanceof Error ? err.message : err);
	process.exit(1);
});
