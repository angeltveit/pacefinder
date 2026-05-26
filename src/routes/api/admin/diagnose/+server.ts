import { error } from '@sveltejs/kit';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { raceSeries, raceEditions } from '$lib/server/db/schema';
import { ilike } from 'drizzle-orm';
import { scrapeKondis } from '$lib/server/agent/sources/kondis';
import { scrapeFriidrett } from '$lib/server/agent/sources/friidrett';
import { searchTavily } from '$lib/server/agent/sources/tavily';
import { searchGoogle } from '$lib/server/agent/sources/google';
import { scrapeEqTiming } from '$lib/server/agent/sources/eqtiming';
import { classifyRaces } from '$lib/server/agent/classifier';
import type { RawRaceLead } from '$lib/server/agent/types';
import type { RequestHandler } from './$types';

function getModel() {
	const provider = env.LLM_PROVIDER ?? 'openai';
	const model = env.LLM_MODEL ?? 'gpt-4o-mini';
	const apiKey = env.LLM_API_KEY;
	if (provider === 'anthropic') return createAnthropic({ apiKey })(model);
	return createOpenAI({ apiKey, baseURL: env.LLM_BASE_URL })(model);
}

/** Returns true if a lead appears to mention the race name (loose word match) */
function leadMentionsRace(lead: RawRaceLead, keywords: string[]): boolean {
	const haystack = `${lead.name} ${lead.description ?? ''} ${lead.rawText ?? ''}`.toLowerCase();
	return keywords.every((kw) => haystack.includes(kw));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') error(403, 'Admin only');

	const { raceName } = await request.json();
	if (!raceName?.trim()) error(400, 'raceName required');

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (msg: string) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`));
			const finish = (answer: string) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'answer', answer })}\n\n`));

			try {
				// Keywords: significant words (≥4 chars) from the race name, lowercased
				const keywords = raceName
					.toLowerCase()
					.split(/\s+/)
					.filter((w: string) => w.length >= 4);

				// ── Step 0: DB check ────────────────────────────────────────────
				send('📦 Step 1/4 — Checking database for existing match…');
				const words = raceName.split(/\s+/).filter((w: string) => w.length >= 4);
				const dbMatches = await db
					.select({ name: raceSeries.name, city: raceSeries.city, firstSeen: raceEditions.firstSeenAt })
					.from(raceSeries)
					.innerJoin(raceEditions, ilike(raceSeries.name, `%${words[0] ?? raceName}%`))
					.limit(5)
					.catch(() => [] as { name: string; city: string | null; firstSeen: Date }[]);

				// Simpler: just ILIKE on series name
				const dbRows = await db
					.select({ name: raceSeries.name, city: raceSeries.city })
					.from(raceSeries)
					.where(ilike(raceSeries.name, `%${words[0] ?? raceName}%`))
					.limit(5);

				if (dbRows.length > 0) {
					send(`✅ Found in database: ${dbRows.map((r) => `"${r.name}" (${r.city})`).join(', ')}`);
					finish(`"${raceName}" **is already in the PaceFinder database** as: ${dbRows.map((r) => `"${r.name}" (${r.city})`).join(', ')}. No action needed.`);
					return;
				}
				send('— Not found in database. Proceeding to source scraping.');

				// ── Step 1: Scrape all sources in parallel ──────────────────────
				send('🌐 Step 2/4 — Scraping all sources (kondis, friidrett, eqtiming, Tavily, Google)…');
				const [kondisLeads, friidrettLeads, eqtimingLeads, tavilyLeads, googleLeads] = await Promise.allSettled([
					scrapeKondis(),
					scrapeFriidrett(),
					scrapeEqTiming(),
					searchTavily(),
					searchGoogle()
				]);

				const allLeads: RawRaceLead[] = [
					...(kondisLeads.status === 'fulfilled' ? kondisLeads.value : []),
					...(friidrettLeads.status === 'fulfilled' ? friidrettLeads.value : []),
					...(eqtimingLeads.status === 'fulfilled' ? eqtimingLeads.value : []),
					...(tavilyLeads.status === 'fulfilled' ? tavilyLeads.value : []),
					...(googleLeads.status === 'fulfilled' ? googleLeads.value : [])
				];

				const sourceStats = [
					`kondis: ${kondisLeads.status === 'fulfilled' ? kondisLeads.value.length : '⚠ failed'}`,
					`friidrett: ${friidrettLeads.status === 'fulfilled' ? friidrettLeads.value.length : '⚠ failed'}`,
					`eqtiming: ${eqtimingLeads.status === 'fulfilled' ? eqtimingLeads.value.length : '⚠ failed'}`,
					`Tavily: ${tavilyLeads.status === 'fulfilled' ? tavilyLeads.value.length : '⚠ failed'}`,
					`Google: ${googleLeads.status === 'fulfilled' ? googleLeads.value.length : '⚠ failed'}`
				].join(', ');
				send(`— Sources returned ${allLeads.length} total leads (${sourceStats})`);

				// ── Step 2: Fuzzy match ─────────────────────────────────────────
				send(`🔍 Step 3/4 — Searching ${allLeads.length} leads for "${raceName}"…`);
				const matchingLeads = allLeads.filter((l) => leadMentionsRace(l, keywords));

				if (matchingLeads.length === 0) {
					send('— Race not found in any source lead.');
					send('🤖 Step 4/4 — Asking LLM to explain why…');

					const { text } = await generateText({
						model: getModel(),
						prompt: `You are a diagnostic assistant for PaceFinder, a running race discovery app.

The admin searched for: **"${raceName}"**

This race was NOT found in any of PaceFinder's sources after a full scrape:
- kondis.no /lopsguiden (${kondisLeads.status === 'fulfilled' ? kondisLeads.value.length : 0} leads)
- friidrett.no /kalender/ (${friidrettLeads.status === 'fulfilled' ? friidrettLeads.value.length : 0} leads)
- Tavily web search with fixed Norwegian/international queries (${tavilyLeads.status === 'fulfilled' ? tavilyLeads.value.length : 0} leads)
- Google Custom Search (${googleLeads.status === 'fulfilled' ? googleLeads.value.length : 0} leads)

Keywords searched for in leads: ${keywords.join(', ')}

Explain concisely why "${raceName}" is likely absent. Consider:
1. Is it listed on kondis.no or friidrett.no at all?
2. Are PaceFinder's Tavily queries broad enough to catch this race?
3. Is this race too local/niche for our current sources?
4. Could the race name differ significantly from what we searched?
Be specific and actionable.`,
						maxTokens: 400
					});
					finish(text);
					return;
				}

				send(`✅ Found ${matchingLeads.length} matching lead(s): ${matchingLeads.map((l) => `"${l.name}" (${l.source})`).join(', ')}`);

				// ── Step 3: Run classifier on the matching leads ────────────────
				send('🤖 Step 4/4 — Running LLM classifier on matching leads…');
				const { classified } = await classifyRaces(matchingLeads);

				if (classified.length === 0) {
					// Classifier returned nothing — leads were likely filtered out
					const leadSummary = matchingLeads
						.map((l) => `- "${l.name}" (${l.source}): ${l.description?.slice(0, 150) ?? 'no description'}`)
						.join('\n');

					const { text } = await generateText({
						model: getModel(),
						prompt: `You are a diagnostic assistant for PaceFinder.

"${raceName}" was found in the scrape sources but the LLM classifier produced NO output for it — it was likely filtered out as irrelevant.

The matching leads were:
${leadSummary}

PaceFinder's classifier keeps races that:
- Are road/trail running races with medals or finisher rewards
- Are in Norway (especially Bergen area) or are notable international races
- Have an upcoming race date

It discards:
- Orienteering, cycling, skiing, swimming, obstacle races
- Races with no medal/finisher reward
- Past races (already happened)
- Very local club events with no broader interest

Explain why the classifier likely discarded "${raceName}". Be specific about which criterion it likely failed.`,
						maxTokens: 400
					});
					finish(text);
					return;
				}

				// Classifier kept it — summarize the result
				const classifiedSummary = classified
					.map(
						(r) =>
							`- "${r.name}" | category: ${r.category} | medal: ${r.medalStatus} | date: ${r.raceDate?.toISOString().slice(0, 10) ?? 'unknown'} | status: ${r.registrationStatus}`
					)
					.join('\n');

				send(`— Classifier kept ${classified.length} race(s):`);
				classified.forEach((r) =>
					send(`  • "${r.name}" — category: ${r.category}, medal: ${r.medalStatus}, status: ${r.registrationStatus}`)
				);

				const { text } = await generateText({
					model: getModel(),
					prompt: `You are a diagnostic assistant for PaceFinder.

"${raceName}" was found in sources AND kept by the classifier with these results:
${classifiedSummary}

It is NOT currently in the PaceFinder database. Explain the most likely reason it hasn't been persisted yet. Possible reasons:
1. Monthly LLM budget was exhausted when the agent last ran — this race was in a batch that wasn't processed
2. The enrichment step failed for this race
3. The agent hasn't run since the race appeared in sources
4. It was deduplicated/merged with another existing race in the DB

Be concise and suggest what the admin should do (e.g. "run the agent again").`,
					maxTokens: 300
				});
				finish(text);
			} catch (err) {
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) })}\n\n`
					)
				);
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
};
