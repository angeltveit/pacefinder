<script lang="ts">
	let { data } = $props();

	let triggering = $state(false);
	let triggerResult = $state('');
	let agentLogs = $state<string[]>([]);
	let extendingBudget = $state(false);
	let monthlyBudget = $state(data.budget.monthlyBudget);
	let spendPct = $derived(Math.min((data.budget.monthlySpend / monthlyBudget) * 100, 100));
	let overBudget = $derived(data.budget.monthlySpend >= monthlyBudget);

	async function triggerAgent() {
		triggering = true;
		triggerResult = '';
		agentLogs = [];
		try {
			const res = await fetch('/api/admin/agent/run', { method: 'POST' });
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const parts = buf.split('\n\n');
				buf = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.startsWith('data: ') ? part.slice(6) : null;
					if (!line) continue;
					try {
						const evt = JSON.parse(line);
						if (evt.type === 'log') agentLogs = [...agentLogs, evt.message];
						else if (evt.type === 'done') triggerResult = `✓ Done — ${evt.racesNew} new, ${evt.racesUpdated} updated`;
						else if (evt.type === 'error') triggerResult = `✗ ${evt.error}`;
					} catch { /* ignore malformed */ }
				}
			}
		} catch {
			triggerResult = '✗ Request failed';
		} finally {
			triggering = false;
		}
	}

	async function extendBudget() {
		extendingBudget = true;
		try {
			const res = await fetch('/api/admin/budget', { method: 'PATCH' });
			const json = await res.json();
			if (res.ok) monthlyBudget = json.budget;
		} finally {
			extendingBudget = false;
		}
	}

	type TestResult = { ok: boolean; message?: string; error?: string } | null;
	let tavilyResult = $state<TestResult>(null);
	let googleResult = $state<TestResult>(null);
	let testingTavily = $state(false);
	let testingGoogle = $state(false);

	async function testSource(source: 'tavily' | 'google') {
		if (source === 'tavily') {
			testingTavily = true;
			tavilyResult = null;
		} else {
			testingGoogle = true;
			googleResult = null;
		}
		try {
			const res = await fetch(`/api/admin/test/${source}`);
			const data = await res.json();
			if (source === 'tavily') tavilyResult = data;
			else googleResult = data;
		} catch {
			const result = { ok: false, error: 'Request failed' };
			if (source === 'tavily') tavilyResult = result;
			else googleResult = result;
		} finally {
			if (source === 'tavily') testingTavily = false;
			else testingGoogle = false;
		}
	}

	function duration(start: string, end: string | null) {
		if (!end) return '—';
		const ms = new Date(end).getTime() - new Date(start).getTime();
		return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
	}

	// ── Add race by URL ──────────────────────────────────────────────────────
	let scrapeUrl = $state('');
	let scraping = $state(false);
	let scrapeLogs = $state<string[]>([]);
	let scrapeResult = $state('');

	async function scrapeRaceUrl() {
		if (!scrapeUrl.trim()) return;
		scraping = true;
		scrapeLogs = [];
		scrapeResult = '';
		try {
			const res = await fetch('/api/admin/races/scrape-url', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: scrapeUrl.trim() })
			});
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const parts = buf.split('\n\n');
				buf = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.startsWith('data: ') ? part.slice(6) : null;
					if (!line) continue;
					try {
						const evt = JSON.parse(line);
						if (evt.type === 'log') scrapeLogs = [...scrapeLogs, evt.message];
						else if (evt.type === 'done') {
							if (evt.message) scrapeResult = `✓ ${evt.message}`;
							else scrapeResult = `✓ Done — ${evt.racesNew} added, ${evt.racesUpdated} updated`;
						} else if (evt.type === 'error') scrapeResult = `✗ ${evt.error}`;
					} catch { /* ignore */ }
				}
			}
		} catch {
			scrapeResult = '✗ Request failed';
		} finally {
			scraping = false;
		}
	}
</script>

<svelte:head><title>Admin Dashboard — PaceFinder</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold text-slate-900">Dashboard</h1>
		<div class="flex items-center gap-3">
			{#if triggerResult}
				<span class="text-sm {triggerResult.startsWith('✓') ? 'text-green-700' : 'text-red-600'}">{triggerResult}</span>
			{/if}
			<button
				onclick={triggerAgent}
				disabled={triggering}
				class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
			>
				{triggering ? 'Running…' : '▶ Run Agent Now'}
			</button>
		</div>
	</div>

	{#if agentLogs.length > 0 || triggering}
		<div class="rounded-2xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-300">
			<div class="mb-2 text-slate-500">Agent log</div>
			{#each agentLogs as line}
				<div>{line}</div>
			{/each}
			{#if triggering}
				<div class="animate-pulse text-slate-500">_</div>
			{/if}
		</div>
	{/if}

	<!-- Add race by URL -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<h2 class="mb-3 font-semibold text-slate-900">Add Race from URL</h2>
		<p class="mb-3 text-sm text-slate-500">Paste any race page URL — Kondis, Friidrett, the race's own website, etc. The agent will scrape it, classify it, and add it to the database.</p>
		<div class="flex gap-2">
			<input
				type="url"
				bind:value={scrapeUrl}
				placeholder="https://example.com/race-page"
				class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
				onkeydown={(e) => e.key === 'Enter' && !scraping && scrapeRaceUrl()}
				disabled={scraping}
			/>
			<button
				onclick={scrapeRaceUrl}
				disabled={scraping || !scrapeUrl.trim()}
				class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
			>
				{scraping ? 'Scraping…' : '⬇ Scrape & Add'}
			</button>
		</div>
		{#if scrapeResult}
			<p class="mt-2 text-sm {scrapeResult.startsWith('✓') ? 'text-green-700' : 'text-red-600'}">{scrapeResult}</p>
		{/if}
		{#if scrapeLogs.length > 0 || scraping}
			<div class="mt-3 rounded-xl bg-slate-900 p-3 font-mono text-xs text-slate-300 max-h-48 overflow-y-auto">
				{#each scrapeLogs as line}
					<div>{line}</div>
				{/each}
				{#if scraping}
					<div class="animate-pulse text-slate-500">_</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Stats grid -->
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
		{#each [
			{ label: 'Total Users', value: data.stats.totalUsers },
			{ label: 'New Users (24h)', value: data.stats.newUsers24h },
			{ label: 'Total Races', value: data.stats.totalRaces },
			{ label: 'Upcoming Races', value: data.stats.upcomingRaces },
			{ label: 'New Races (24h)', value: data.stats.newRaces24h },
			{ label: 'Total Comments', value: data.stats.totalComments }
		] as stat}
			<div class="rounded-2xl border border-slate-200 bg-white p-5">
				<p class="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</p>
				<p class="mt-1 text-3xl font-bold text-slate-900">{stat.value}</p>
			</div>
		{/each}
	</div>

	<!-- Token usage (Redis) -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Token Usage & Cost</h2>
			{#if !data.redis.available}
				<span class="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs text-amber-700">Redis unavailable</span>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#each [
				{ label: 'Tokens in (today)', value: data.redis.tokensInToday?.toLocaleString() ?? '—' },
				{ label: 'Tokens out (today)', value: data.redis.tokensOutToday?.toLocaleString() ?? '—' },
				{ label: 'Cost today', value: data.redis.costToday ? `$${data.redis.costToday}` : '—' },
				{ label: 'Cost all-time', value: data.redis.costAlltime ? `$${data.redis.costAlltime}` : '—' }
			] as stat}
				<div>
					<p class="text-xs text-slate-500">{stat.label}</p>
					<p class="text-xl font-bold text-slate-900">{stat.value}</p>
				</div>
			{/each}
		</div>
	</div>

	<!-- Top races -->
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="rounded-2xl border border-slate-200 bg-white p-5">
			<h2 class="mb-3 font-semibold text-slate-900">Most Interested</h2>
			<ol class="space-y-2">
				{#each data.topInterested as r}
					<li class="flex items-center justify-between text-sm">
						<a href="/races/{r.id}" class="text-blue-600 hover:underline truncate">{r.name}</a>
						<span class="ml-2 font-medium text-slate-600 shrink-0">{r.count} ❤️</span>
					</li>
				{/each}
			</ol>
		</div>
		<div class="rounded-2xl border border-slate-200 bg-white p-5">
			<h2 class="mb-3 font-semibold text-slate-900">Most Commented</h2>
			<ol class="space-y-2">
				{#each data.topCommented as r}
					<li class="flex items-center justify-between text-sm">
						<a href="/races/{r.id}" class="text-blue-600 hover:underline truncate">{r.name}</a>
						<span class="ml-2 font-medium text-slate-600 shrink-0">{r.count} 💬</span>
					</li>
				{/each}
			</ol>
		</div>
	</div>

	<!-- Connection tests -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<h2 class="mb-4 font-semibold text-slate-900">Search Connections</h2>
		<div class="space-y-3">
			{#each [
				{ key: 'tavily' as const, label: 'Tavily', testing: testingTavily, result: tavilyResult }
			] as src}
				<div class="flex items-center gap-3">
					<button
						onclick={() => testSource(src.key)}
						disabled={src.testing}
						class="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
					>
						{src.testing ? 'Testing…' : `Test ${src.label}`}
					</button>
					{#if src.result}
						<span class="text-sm {src.result.ok ? 'text-green-700' : 'text-red-600'}">
							{src.result.ok ? `✓ ${src.result.message}` : `✗ ${src.result.error}`}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Monthly LLM budget -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Monthly LLM Budget</h2>
			<button
				onclick={extendBudget}
				disabled={extendingBudget}
				class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
			>
				{extendingBudget ? '…' : '+ $10'}
			</button>
		</div>
		<div class="mb-2 flex items-end gap-2">
			<span class="text-2xl font-bold {overBudget ? 'text-red-600' : 'text-slate-900'}">
				${data.budget.monthlySpend.toFixed(2)}
			</span>
			<span class="mb-0.5 text-sm text-slate-500">/ ${monthlyBudget.toFixed(2)} this month</span>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
			<div
				class="h-full rounded-full transition-all {overBudget ? 'bg-red-500' : spendPct > 80 ? 'bg-amber-400' : 'bg-blue-500'}"
				style="width: {spendPct}%"
			></div>
		</div>
		{#if overBudget}
			<p class="mt-2 text-xs text-red-600">Budget exceeded — agent runs are blocked. Press + $10 to extend.</p>
		{/if}
	</div>

	<!-- Recent agent runs -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<h2 class="mb-4 font-semibold text-slate-900">Recent Agent Runs</h2>
		{#if data.lastRuns.length === 0}
			<p class="text-sm text-slate-500">No runs yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
							<th class="pb-2 pr-4">Started</th>
							<th class="pb-2 pr-4">Duration</th>
							<th class="pb-2 pr-4">Status</th>
							<th class="pb-2 pr-4">New</th>
							<th class="pb-2 pr-4">Updated</th>
							<th class="pb-2 pr-4">Tokens</th>
							<th class="pb-2">Cost</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-50">
						{#each data.lastRuns as run}
							<tr class="py-2">
								<td class="py-2 pr-4 text-slate-600 whitespace-nowrap">
									{new Date(run.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
								</td>
								<td class="py-2 pr-4 text-slate-600">{duration(run.startedAt, run.finishedAt)}</td>
								<td class="py-2 pr-4">
									<span class="rounded-full px-2 py-0.5 text-xs font-medium
										{run.status === 'completed' ? 'bg-green-50 text-green-700' :
										 run.status === 'failed' ? 'bg-red-50 text-red-700' :
										 'bg-amber-50 text-amber-700'}">
										{run.status}
									</span>
								</td>
								<td class="py-2 pr-4 font-medium text-slate-900">{run.racesNew ?? 0}</td>
								<td class="py-2 pr-4 text-slate-600">{run.racesUpdated ?? 0}</td>
								<td class="py-2 pr-4 text-slate-600">
									{((run.tokensInput ?? 0) + (run.tokensOutput ?? 0)).toLocaleString()}
								</td>
								<td class="py-2 text-slate-600">
									{run.estimatedCostUsd ? `$${run.estimatedCostUsd.toFixed(4)}` : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
