/**
 * Image proxy — fetches remote race photos server-side so the browser never
 * hotlinks them directly. Many race/Instagram/Facebook images return
 * ERR_BLOCKED_BY_ORB or hotlink-protect when loaded cross-origin; fetching them
 * from the server with a browser-like UA and Referer sidesteps that and lets us
 * cache aggressively at the edge.
 */
import { error } from '@sveltejs/kit';
import { fetch as undiciFetch, Agent } from 'undici';
import type { RequestHandler } from './$types';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB safety cap
const ALLOWED_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/i;

/** Block requests to private / internal hosts to avoid SSRF. */
function isBlockedHost(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
		return true;
	}
	// Literal IPv4 private / loopback / link-local ranges
	if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
		return true;
	}
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
	// IPv6 loopback / unique-local / link-local
	if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
	// Cloud metadata endpoint
	if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
	return false;
}

export const GET: RequestHandler = async ({ url, fetch, setHeaders }) => {
	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url');

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid url');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw error(400, 'Unsupported protocol');
	}
	if (isBlockedHost(parsed.hostname)) {
		throw error(403, 'Host not allowed');
	}

	const requestHeaders = {
		'User-Agent':
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
		Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
		// A same-origin-looking Referer defeats most hotlink protection
		Referer: `${parsed.protocol}//${parsed.host}/`
	};

	let res: Response;
	try {
		res = await fetch(parsed.href, {
			headers: requestHeaders,
			redirect: 'follow',
			signal: AbortSignal.timeout(12_000)
		});
	} catch {
		// Retry with SSL verification disabled — some race-timing sites have
		// self-signed or unrecognised-CA certificates.
		try {
			const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
			res = await undiciFetch(parsed.href, {
				headers: requestHeaders,
				redirect: 'follow',
				signal: AbortSignal.timeout(12_000),
				dispatcher: insecureAgent
			}) as unknown as Response;
		} catch {
			throw error(502, 'Upstream fetch failed');
		}
	}

	if (!res.ok || !res.body) throw error(502, `Upstream ${res.status}`);

	const contentType = res.headers.get('content-type') ?? '';
	if (!ALLOWED_TYPES.test(contentType)) throw error(415, 'Not an image');

	const contentLength = Number(res.headers.get('content-length') ?? 0);
	if (contentLength > MAX_BYTES) throw error(413, 'Image too large');

	const buf = new Uint8Array(await res.arrayBuffer());
	if (buf.byteLength > MAX_BYTES) throw error(413, 'Image too large');

	// Cache hard: race photos rarely change. 1 day browser, 30 days CDN.
	setHeaders({
		'Content-Type': contentType,
		'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800'
	});

	return new Response(buf);
};
