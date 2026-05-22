<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';
	import { page } from '$app/state';

	let { data } = $props();

	const categories = [
		{ value: '', label: 'All' },
		{ value: 'local', label: 'Local' },
		{ value: 'norway', label: 'Norway' },
		{ value: 'international', label: 'International' }
	];

	const medals = [
		{ value: '', label: 'Any medal' },
		{ value: 'confirmed', label: 'Confirmed' },
		{ value: 'likely', label: 'Likely' },
		{ value: 'unclear', label: 'Unclear' }
	];

	const regStatuses = [
		{ value: '', label: 'Any status' },
		{ value: 'open', label: 'Open' },
		{ value: 'opening_soon', label: 'Opening soon' },
		{ value: 'unknown', label: 'Unknown' },
		{ value: 'closed', label: 'Closed' }
	];

	const myStatuses = [
		{ value: '', label: 'All' },
		{ value: 'interested', label: 'Interested' },
		{ value: 'following', label: 'Following' },
		{ value: 'seen', label: 'Seen' },
		{ value: 'skip', label: 'Skipped' }
	];

	function buildUrl(overrides: Record<string, string>) {
		const params = new URLSearchParams({
			category: data.filters.category,
			medal: data.filters.medal,
			reg: data.filters.regStatus,
			mine: data.filters.myStatus,
			...overrides
		});
		// Remove empty params
		for (const [k, v] of [...params]) {
			if (!v) params.delete(k);
		}
		return `/races?${params}`;
	}

	const totalPages = $derived(Math.ceil(data.total / data.pageSize));
</script>

<svelte:head><title>All Races — RaceScout</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">All Races</h1>
		<p class="mt-1 text-sm text-slate-500">{data.total} races in database</p>
	</div>

	<!-- Filters -->
	<div class="rounded-2xl border border-slate-200 bg-white p-4">
		<div class="flex flex-wrap gap-3">
			<div class="flex flex-col gap-1">
				<p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Category</p>
				<div class="flex gap-1">
					{#each categories as cat}
						<a
							href={buildUrl({ category: cat.value, page: '1' })}
							class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
								{data.filters.category === cat.value
									? 'bg-blue-600 text-white'
									: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
						>
							{cat.label}
						</a>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-slate-500 uppercase tracking-wide" for="filter-medal">Medal</label>
				<select id="filter-medal"
					class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
					onchange={(e) => { window.location.href = buildUrl({ medal: (e.target as HTMLSelectElement).value, page: '1' }); }}
				>
					{#each medals as m}
						<option value={m.value} selected={data.filters.medal === m.value}>{m.label}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-slate-500 uppercase tracking-wide" for="filter-reg">Registration</label>
				<select id="filter-reg"
					class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
					onchange={(e) => { window.location.href = buildUrl({ reg: (e.target as HTMLSelectElement).value, page: '1' }); }}
				>
					{#each regStatuses as s}
						<option value={s.value} selected={data.filters.regStatus === s.value}>{s.label}</option>
					{/each}
				</select>
			</div>

			{#if data.user}
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-slate-500 uppercase tracking-wide" for="filter-mine">My status</label>
					<select
						id="filter-mine"
						class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
						onchange={(e) => { window.location.href = buildUrl({ mine: (e.target as HTMLSelectElement).value, page: '1' }); }}
					>
						{#each myStatuses as s}
							<option value={s.value} selected={data.filters.myStatus === s.value}>{s.label}</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>
	</div>

	<!-- Race list -->
	{#if data.raceItems.length === 0}
		<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
			<p class="text-slate-500">No races match your filters.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.raceItems as race (race.id)}
				<RaceCard {race} user={data.user} />
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-center gap-2">
				{#if data.page > 1}
					<a href={buildUrl({ page: String(data.page - 1) })}
						class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
						← Previous
					</a>
				{/if}
				<span class="text-sm text-slate-500">Page {data.page} of {totalPages}</span>
				{#if data.page < totalPages}
					<a href={buildUrl({ page: String(data.page + 1) })}
						class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
						Next →
					</a>
				{/if}
			</div>
		{/if}
	{/if}
</div>
