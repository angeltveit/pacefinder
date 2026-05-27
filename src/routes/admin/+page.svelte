<script lang="ts">
	let { data } = $props();

	let triggering = $state(false);
	let triggerResult = $state('');
	let agentLogs = $state<string[]>([]);
	let extendingBudget = $state(false);
	let monthlyBudget = $state(data.budget.monthlyBudget);
	let spendPct = $derived(Math.min((data.budget.monthlySpend / monthlyBudget) * 100, 100));
	let overBudget = $derived(data.budget.monthlySpend >= monthlyBudget);

	const allSources = [
		{ id: 'eqtiming', label: 'EQ Timing', countries: 'NO/SE' },
		{ id: 'sportstiming', label: 'SportsTiming', countries: 'DK/SE' },
		{ id: 'timataka', label: 'Timataka', countries: 'IS' },
		{ id: 'racetimer', label: 'RaceTimer', countries: 'SE' },
		{ id: 'kondis', label: 'Kondis', countries: 'NO' },
		{ id: 'friidrett', label: 'Friidrett', countries: 'NO' }
	];
	let enabledSources = $state<string[]>(allSources.map((s) => s.id));

	function toggleSource(id: string) {
		if (enabledSources.includes(id)) {
			enabledSources = enabledSources.filter((s) => s !== id);
		} else {
			enabledSources = [...enabledSources, id];
		}
	}

	let abortController: AbortController | null = null;

	async function triggerAgent() {
		triggering = true;
		triggerResult = '';
		agentLogs = [];
		abortController = new AbortController();
		try {
			const res = await fetch('/api/admin/agent/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sources: enabledSources }),
				signal: abortController.signal
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
						if (evt.type === 'log') agentLogs = [...agentLogs, evt.message];
						else if (evt.type === 'done') triggerResult = `✓ Done — ${evt.racesNew} new, ${evt.racesUpdated} updated`;
						else if (evt.type === 'error') triggerResult = `✗ ${evt.error}`;
					} catch { /* ignore malformed */ }
				}
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				triggerResult = '⏹ Cancelled';
			} else {
				triggerResult = '✗ Request failed';
			}
		} finally {
			triggering = false;
			abortController = null;
		}
	}

	function cancelAgent() {
		abortController?.abort();
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

	let diagnoseName = $state('');
	let diagnosing = $state(false);
	let diagnoseLogs = $state<string[]>([]);
	let diagnoseAnswer = $state('');

	async function diagnoseRace() {
		if (!diagnoseName.trim()) return;
		diagnosing = true;
		diagnoseLogs = [];
		diagnoseAnswer = '';
		try {
			const res = await fetch('/api/admin/diagnose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ raceName: diagnoseName.trim() })
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
						if (evt.type === 'log') diagnoseLogs = [...diagnoseLogs, evt.message];
						else if (evt.type === 'answer') diagnoseAnswer = evt.answer;
						else if (evt.type === 'error') diagnoseAnswer = '⚠ ' + evt.error;
					} catch { /* ignore */ }
				}
			}
		} catch {
			diagnoseAnswer = '⚠ Request failed';
		} finally {
			diagnosing = false;
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
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold text-slate-100">Dashboard</h1>
		<div class="flex items-center gap-3">
			{#if triggerResult}
				<span class="text-sm {triggerResult.startsWith('✓') ? 'text-green-400' : triggerResult.startsWith('⏹') ? 'text-amber-400' : 'text-red-400'}">{triggerResult}</span>
			{/if}
			{#if triggering}
				<button
					onclick={cancelAgent}
					class="rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-900/30"
				>
					⏹ Cancel
				</button>
			{/if}
			<button
				onclick={triggerAgent}
				disabled={triggering || enabledSources.length === 0}
				class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-900 hover:brightness-110 disabled:opacity-60"
			>
				{triggering ? 'Running…' : '▶ Run Agent'}
			</button>
		</div>
	</div>

	<!-- Source selection -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<h2 class="mb-3 font-semibold text-slate-100">Sources to scrape</h2>
		<div class="flex flex-wrap gap-3">
			{#each allSources as source}
				<label class="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/60 px-3 py-2 text-sm cursor-pointer select-none hover:border-slate-600 transition-colors {enabledSources.includes(source.id) ? 'border-brand/50 bg-brand/10' : ''}">
					<input
						type="checkbox"
						checked={enabledSources.includes(source.id)}
						onchange={() => toggleSource(source.id)}
						disabled={triggering}
						class="accent-brand"
					/>
					<span class="text-slate-200">{source.label}</span>
					<span class="text-xs text-slate-500">{source.countries}</span>
				</label>
			{/each}
		</div>
		{#if enabledSources.length === 0}
			<p class="mt-2 text-xs text-amber-400">Select at least one source to run the agent.</p>
		{/if}
	</div>

	<!-- Agent log -->
	{#if agentLogs.length > 0 || triggering}
		<div class="rounded-2xl border border-slate-700/50 bg-slate-900 p-4 font-mono text-xs text-slate-300">
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
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<h2 class="mb-1 font-semibold text-slate-100">Add Race from URL</h2>
		<p class="mb-3 text-sm text-slate-400">Paste any race page URL — Kondis, Friidrett, the race's own website, etc.</p>
		<div class="flex gap-2">
			<input
				type="url"
				bind:value={scrapeUrl}
				placeholder="https://example.com/race-page"
				class="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none"
				onkeydown={(e) => e.key === 'Enter' && !scraping && scrapeRaceUrl()}
				disabled={scraping}
			/>
			<button
				onclick={scrapeRaceUrl}
				disabled={scraping || !scrapeUrl.trim()}
				class="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-900 hover:brightness-110 disabled:opacity-60"
			>
				{scraping ? 'Scraping…' : '⬇ Scrape & Add'}
			</button>
		</div>
		{#if scrapeResult}
			<p class="mt-2 text-sm {scrapeResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}">{scrapeResult}</p>
		{/if}
		{#if scrapeLogs.length > 0 || scraping}
			<div class="mt-3 max-h-48 overflow-y-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-slate-300">
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
			<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
				<p class="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
				<p class="mt-1 text-3xl font-bold text-slate-100">{stat.value}</p>
			</div>
		{/each}
	</div>

	<!-- Token usage -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="font-semibold text-slate-100">Token Usage & Cost</h2>
			{#if !data.redis.available}
				<span class="rounded-full border border-amber-700/50 bg-amber-900/30 px-2.5 py-0.5 text-xs text-amber-400">Redis unavailable</span>
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
					<p class="text-xs text-slate-400">{stat.label}</p>
					<p class="text-xl font-bold text-slate-100">{stat.value}</p>
				</div>
			{/each}
		</div>
	</div>

	<!-- Top races -->
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
			<h2 class="mb-3 font-semibold text-slate-100">Most Interested</h2>
			<ol class="space-y-2">
				{#each data.topInterested as r}
					<li class="flex items-center justify-between text-sm">
						<a href="/races/{r.id}" class="truncate text-brand hover:underline">{r.name}</a>
						<span class="ml-2 shrink-0 font-medium text-slate-400">{r.count} ❤️</span>
					</li>
				{/each}
			</ol>
		</div>
		<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
			<h2 class="mb-3 font-semibold text-slate-100">Most Commented</h2>
			<ol class="space-y-2">
				{#each data.topCommented as r}
					<li class="flex items-center justify-between text-sm">
						<a href="/races/{r.id}" class="truncate text-brand hover:underline">{r.name}</a>
						<span class="ml-2 shrink-0 font-medium text-slate-400">{r.count} 💬</span>
					</li>
				{/each}
			</ol>
		</div>
	</div>

	<!-- Connection tests -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<h2 class="mb-4 font-semibold text-slate-100">Search Connections</h2>
		<div class="space-y-3">
			{#each [
				{ key: 'tavily' as const, label: 'Tavily', testing: testingTavily, result: tavilyResult }
			] as src}
				<div class="flex items-center gap-3">
					<button
						onclick={() => testSource(src.key)}
						disabled={src.testing}
						class="w-32 rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-60"
					>
						{src.testing ? 'Testing…' : `Test ${src.label}`}
					</button>
					{#if src.result}
						<span class="text-sm {src.result.ok ? 'text-green-400' : 'text-red-400'}">
							{src.result.ok ? `✓ ${src.result.message}` : `✗ ${src.result.error}`}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Monthly LLM budget -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="font-semibold text-slate-100">Monthly LLM Budget</h2>
			<button
				onclick={extendBudget}
				disabled={extendingBudget}
				class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-60"
			>
				{extendingBudget ? '…' : '+ $10'}
			</button>
		</div>
		<div class="mb-2 flex items-end gap-2">
			<span class="text-2xl font-bold {overBudget ? 'text-red-400' : 'text-slate-100'}">
				${data.budget.monthlySpend.toFixed(2)}
			</span>
			<span class="mb-0.5 text-sm text-slate-400">/ ${monthlyBudget.toFixed(2)} this month</span>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-slate-700">
			<div
				class="h-full rounded-full transition-all {overBudget ? 'bg-red-500' : spendPct > 80 ? 'bg-amber-400' : 'bg-brand'}"
				style="width: {spendPct}%"
			></div>
		</div>
		{#if overBudget}
			<p class="mt-2 text-xs text-red-400">Budget exceeded — agent runs are blocked. Press + $10 to extend.</p>
		{/if}
	</div>

	<!-- Recent agent runs -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<h2 class="mb-4 font-semibold text-slate-100">Recent Agent Runs</h2>
		{#if data.lastRuns.length === 0}
			<p class="text-sm text-slate-500">No runs yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
							<th class="pb-2 pr-4">Started</th>
							<th class="pb-2 pr-4">Duration</th>
							<th class="pb-2 pr-4">Status</th>
							<th class="pb-2 pr-4">New</th>
							<th class="pb-2 pr-4">Updated</th>
							<th class="pb-2 pr-4">Tokens</th>
							<th class="pb-2">Cost</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-700/30">
						{#each data.lastRuns as run}
							<tr>
								<td class="py-2 pr-4 whitespace-nowrap text-slate-400">
									{new Date(run.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
								</td>
								<td class="py-2 pr-4 text-slate-400">{duration(run.startedAt, run.finishedAt)}</td>
								<td class="py-2 pr-4">
									<span class="rounded-full px-2 py-0.5 text-xs font-medium
										{run.status === 'completed' ? 'bg-green-900/40 text-green-400' :
										 run.status === 'failed' ? 'bg-red-900/40 text-red-400' :
										 'bg-amber-900/40 text-amber-400'}">
										{run.status}
									</span>
								</td>
								<td class="py-2 pr-4 font-semibold text-slate-100">{run.racesNew ?? 0}</td>
								<td class="py-2 pr-4 text-slate-400">{run.racesUpdated ?? 0}</td>
								<td class="py-2 pr-4 text-slate-400">
									{((run.tokensInput ?? 0) + (run.tokensOutput ?? 0)).toLocaleString()}
								</td>
								<td class="py-2 text-slate-400">
									{run.estimatedCostUsd ? `$${run.estimatedCostUsd.toFixed(4)}` : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- ── Diagnose missing race ── -->
	<div class="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
		<div class="mb-4 text-sm font-semibold text-slate-100">🔎 Why isn't this race in PaceFinder?</div>
		<div class="flex gap-2">
			<input
				class="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none"
				placeholder="Race name, e.g. Fana Folkefest"
				bind:value={diagnoseName}
				onkeydown={(e) => e.key === 'Enter' && diagnoseRace()}
			/>
			<button
				class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
				onclick={diagnoseRace}
				disabled={diagnosing || !diagnoseName.trim()}
			>
				{diagnosing ? 'Diagnosing…' : 'Diagnose'}
			</button>
		</div>
		{#if diagnoseLogs.length > 0 || diagnoseAnswer}
			<div class="mt-3 space-y-2">
				{#if diagnoseLogs.length > 0}
					<div class="max-h-40 overflow-y-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-slate-400">
						{#each diagnoseLogs as log}
							<div>{log}</div>
						{/each}
						{#if diagnosing}<div class="animate-pulse text-slate-500">_</div>{/if}
					</div>
				{/if}
				{#if diagnoseAnswer}
					<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{diagnoseAnswer}</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
