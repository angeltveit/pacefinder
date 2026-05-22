<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';

	let { data } = $props();
	let events = $state(data.events);

	const categories = [
		{ value: '', label: '🏁 All', emoji: '🏁' },
		{ value: 'local', label: '🏃 Local', emoji: '🏃' },
		{ value: 'norway', label: '🧳 Norway', emoji: '🧳' },
		{ value: 'international', label: '✈️ World', emoji: '✈️' }
	];

	const medals = [
		{ value: '', label: 'Any medal' },
		{ value: 'confirmed', label: '🏅 Confirmed' },
		{ value: 'likely', label: '🥈 Likely' },
		{ value: 'unclear', label: '❓ Unclear' }
	];

	const regStatuses = [
		{ value: '', label: 'Any' },
		{ value: 'open', label: '🟢 Open' },
		{ value: 'opening_soon', label: '⏰ Soon' },
		{ value: 'unknown', label: '❓ Unknown' },
		{ value: 'closed', label: '🔒 Closed' }
	];

	const myStatuses = [
		{ value: '', label: 'All' },
		{ value: 'interested', label: '❤️ Tracked' },
		{ value: 'following', label: '🔔 Following' },
		{ value: 'seen', label: '👁 Seen' },
		{ value: 'skip', label: '✕ Skipped' }
	];

	function buildUrl(overrides: Record<string, string>) {
		const params = new URLSearchParams({
			category: data.filters.category,
			medal: data.filters.medal,
			reg: data.filters.regStatus,
			mine: data.filters.myStatus,
			...overrides
		});
		for (const [k, v] of [...params]) {
			if (!v) params.delete(k);
		}
		return `/races?${params}`;
	}

</script>

<svelte:head><title>Browse Races — PaceFinder</title></svelte:head>

<div class="page">
	<!-- Header -->
	<div class="header">
		<h1 class="page-title">🏁 Browse all events</h1>
		<p class="page-sub">{data.total} events scouted so far</p>
	</div>

	<!-- Filter bar -->
	<div class="filter-bar hide-scrollbar">
		{#each categories as cat}
			<a
				href={buildUrl({ category: cat.value })}
				class="filter-chip {data.filters.category === cat.value ? 'active' : ''}"
			>
				{cat.label}
			</a>
		{/each}
	</div>

	<!-- Dropdowns row -->
	<div class="dropdown-row">
		<select
			class="filter-select"
			onchange={(e) => { window.location.href = buildUrl({ medal: (e.target as HTMLSelectElement).value }); }}
		>
			{#each medals as m}
				<option value={m.value} selected={data.filters.medal === m.value}>{m.label}</option>
			{/each}
		</select>

		<select
			class="filter-select"
			onchange={(e) => { window.location.href = buildUrl({ reg: (e.target as HTMLSelectElement).value }); }}
		>
			{#each regStatuses as s}
				<option value={s.value} selected={data.filters.regStatus === s.value}>{s.label}</option>
			{/each}
		</select>

		{#if data.user}
			<select
				class="filter-select"
				onchange={(e) => { window.location.href = buildUrl({ mine: (e.target as HTMLSelectElement).value }); }}
			>
				{#each myStatuses as s}
					<option value={s.value} selected={data.filters.myStatus === s.value}>{s.label}</option>
				{/each}
			</select>
		{/if}
	</div>

	<!-- Event list -->
	{#if events.length === 0}
		<div class="empty-state">
			<p>Nothing matches these filters. Try loosening up! 🤷</p>
		</div>
	{:else}
		<div class="feed">
			{#each events as event (event.primaryId)}
				<RaceCard {event} user={data.user} onDelete={(id: string) => events = events.filter(e => e.primaryId !== id)} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.header { text-align: center; padding-top: 8px; }
	.page-title {
		font-size: 1.5rem;
		font-weight: 900;
		color: white;
	}
	.page-sub {
		font-size: 0.85rem;
		color: #64748b;
		margin-top: 4px;
	}

	.filter-bar {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 4px 0;
	}
	.filter-chip {
		flex-shrink: 0;
		padding: 10px 18px;
		border-radius: 14px;
		font-size: 0.85rem;
		font-weight: 700;
		color: #94a3b8;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.08);
		text-decoration: none;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.filter-chip:hover {
		color: white;
		background: rgba(255,255,255,0.09);
	}
	.filter-chip.active {
		color: #0c0f1a;
		background: #a3e635;
		border-color: #a3e635;
	}

	.dropdown-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.filter-select {
		flex: 1;
		min-width: 100px;
		padding: 10px 14px;
		border-radius: 12px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #94a3b8;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.08);
		cursor: pointer;
	}
	.filter-select:focus {
		outline: none;
		border-color: rgba(163,230,53,0.4);
	}

	.feed {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.empty-state {
		text-align: center;
		padding: 48px 16px;
		border-radius: 1.25rem;
		border: 2px dashed rgba(255,255,255,0.06);
		color: #64748b;
		font-size: 0.95rem;
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 16px 0;
	}
	.page-btn {
		padding: 10px 20px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 700;
		color: white;
		background: rgba(255,255,255,0.07);
		border: 1.5px solid rgba(255,255,255,0.1);
		text-decoration: none;
		transition: all 0.15s;
	}
	.page-btn:hover {
		background: rgba(255,255,255,0.12);
	}
	.page-info {
		font-size: 0.82rem;
		color: #64748b;
		font-weight: 600;
	}
</style>
