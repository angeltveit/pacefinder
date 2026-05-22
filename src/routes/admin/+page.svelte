<script lang="ts">
	let { data } = $props();

	let triggering = $state(false);
	let triggerResult = $state('');

	async function triggerAgent() {
		const secret = prompt('Enter AGENT_SECRET:');
		if (!secret) return;
		triggering = true;
		triggerResult = '';
		try {
			const res = await fetch('/api/agent/run', {
				method: 'POST',
				headers: { 'x-agent-secret': secret }
			});
			const json = await res.json();
			triggerResult = json.ok
				? `✓ Done — ${json.racesNew} new races, ${json.racesUpdated} updated`
				: `✗ Error: ${json.error}`;
		} catch {
			triggerResult = '✗ Request failed';
		} finally {
			triggering = false;
		}
	}

	function duration(start: string, end: string | null) {
		if (!end) return '—';
		const ms = new Date(end).getTime() - new Date(start).getTime();
		return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
	}
</script>

<svelte:head><title>Admin Dashboard — RaceScout</title></svelte:head>

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
