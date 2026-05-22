<script lang="ts">
	let { data } = $props();

	function duration(start: string, end: string | null) {
		if (!end) return '—';
		const ms = new Date(end).getTime() - new Date(start).getTime();
		return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
	}
</script>

<svelte:head><title>Agent Runs — Admin</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-bold text-slate-900">Agent Runs</h2>

	{#if data.runs.length === 0}
		<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
			<p class="text-slate-500">No runs yet.</p>
		</div>
	{:else}
		<div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 border-b border-slate-200">
					<tr class="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
						<th class="px-4 py-3">Started</th>
						<th class="px-4 py-3">Duration</th>
						<th class="px-4 py-3">Status</th>
						<th class="px-4 py-3">Scanned</th>
						<th class="px-4 py-3">New</th>
						<th class="px-4 py-3">Updated</th>
						<th class="px-4 py-3">Tokens</th>
						<th class="px-4 py-3">Cost</th>
						<th class="px-4 py-3">Sources</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.runs as run}
						<tr class="hover:bg-slate-50 align-top">
							<td class="px-4 py-3 text-slate-600 whitespace-nowrap">
								{new Date(run.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
							</td>
							<td class="px-4 py-3 text-slate-600">{duration(run.startedAt, run.finishedAt)}</td>
							<td class="px-4 py-3">
								<span class="rounded-full px-2 py-0.5 text-xs font-medium
									{run.status === 'completed' ? 'bg-green-50 text-green-700' :
									 run.status === 'failed' ? 'bg-red-50 text-red-700' :
									 'bg-amber-50 text-amber-700'}">
									{run.status}
								</span>
							</td>
							<td class="px-4 py-3 text-slate-600">{run.racesScanned ?? 0}</td>
							<td class="px-4 py-3 font-medium text-slate-900">{run.racesNew ?? 0}</td>
							<td class="px-4 py-3 text-slate-600">{run.racesUpdated ?? 0}</td>
							<td class="px-4 py-3 text-slate-600">
								{((run.tokensInput ?? 0) + (run.tokensOutput ?? 0)).toLocaleString()}
							</td>
							<td class="px-4 py-3 text-slate-600">
								{run.estimatedCostUsd ? `$${run.estimatedCostUsd.toFixed(4)}` : '—'}
							</td>
							<td class="px-4 py-3 text-slate-500 text-xs">
								{Array.isArray(run.sourcesUsed) ? (run.sourcesUsed as string[]).join(', ') : '—'}
							</td>
						</tr>
						{#if run.errorLog}
							<tr class="bg-red-50">
								<td colspan="9" class="px-4 py-2 text-xs text-red-700 font-mono">{run.errorLog}</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
