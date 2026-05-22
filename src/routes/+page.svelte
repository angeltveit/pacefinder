<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';

	let { data } = $props();
</script>

<svelte:head><title>RaceScout — New Races</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">New Races</h1>
		<p class="mt-1 text-sm text-slate-500">Races discovered in the last 7 days</p>
	</div>

	{#if data.raceItems.length === 0}
		<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
			<p class="text-slate-500">No new races found yet. The agent hasn't run or found no qualifying races.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.raceItems as race (race.id)}
				<RaceCard {race} user={data.user} />
			{/each}
		</div>
	{/if}
</div>

