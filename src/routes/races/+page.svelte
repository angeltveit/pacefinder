<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	let events = $state(data.events);
	let searchValue = $state(data.filters.q);

	// Re-sync local state when SvelteKit re-runs the load after filter navigation.
	$effect(() => { events = data.events; });
	$effect(() => { searchValue = data.filters.q; });

	const categories = [
		{ value: '', label: 'All races' },
		{ value: 'local', label: 'Local' },
		{ value: 'travel', label: 'Travel' }
	];

	const timeOptions = [
		{ value: 'upcoming', label: 'Upcoming' },
		{ value: 'past', label: 'Past' },
		{ value: 'all', label: 'All time' }
	];

	const medals = [
		{ value: '', label: 'Any medal' },
		{ value: 'confirmed', label: 'Medal confirmed' },
		{ value: 'likely', label: 'Medal likely' },
		{ value: 'unclear', label: 'Medal unclear' }
	];

	const regStatuses = [
		{ value: '', label: 'Any status' },
		{ value: 'open', label: 'Registration open' },
		{ value: 'opening_soon', label: 'Opening soon' },
		{ value: 'unknown', label: 'Status unknown' },
		{ value: 'closed', label: 'Closed' }
	];

	const myStatuses = [
		{ value: '', label: 'All' },
		{ value: 'interested', label: 'Tracked' },
		{ value: 'following', label: 'Following' },
		{ value: 'seen', label: 'Seen' },
		{ value: 'skip', label: 'Skipped' }
	];

	function buildUrl(overrides: Record<string, string>) {
		const params = new URLSearchParams({
			q: data.filters.q,
			category: data.filters.category,
			time: data.filters.time,
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

	function submitSearch(e: Event) {
		e.preventDefault();
		window.location.href = buildUrl({ q: searchValue });
	}

</script>

<svelte:head>
	<title>Explore Races — PaceFinder</title>
	<meta name="description" content="Browse {data.total} running races scouted across the Nordics and beyond — filter by distance, date and location." />
	<meta property="og:title" content="Explore Races — PaceFinder" />
	<meta property="og:description" content="Browse {data.total} running races scouted across the Nordics and beyond — filter by distance, date and location." />
	<meta property="og:url" content="{data.origin}/races" />
	<meta property="og:type" content="website" />
	<meta name="twitter:title" content="Explore Races — PaceFinder" />
	<meta name="twitter:description" content="Browse {data.total} running races scouted across the Nordics and beyond — filter by distance, date and location." />
</svelte:head>

<div class="page">
	<!-- Header -->
	<div class="header pf-rise">
		<h1 class="page-title">Explore every race</h1>
		<p class="page-sub">{data.total} events scouted across the Nordics and beyond</p>
	</div>

	<!-- Search -->
	<form class="search-bar" onsubmit={submitSearch}>
		<span class="search-ic"><Icon name="search" size={18} /></span>
		<input
			type="text"
			class="search-input"
			placeholder="Search by race name or city…"
			bind:value={searchValue}
		/>
		<button type="submit" class="search-btn">Search</button>
	</form>

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
		<span class="filter-divider"></span>
		{#each timeOptions as t}
			<a
				href={buildUrl({ time: t.value })}
				class="filter-chip {data.filters.time === t.value ? 'active' : ''}"
			>
				{t.label}
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
			<Icon name="search" size={26} />
			<p>Nothing matches these filters. Try loosening them up.</p>
		</div>
	{:else}
		<div class="grid">
			{#each events as event, i (event.primaryId)}
				<RaceCard {event} user={data.user} index={i} onDelete={(id: string) => events = events.filter(e => e.primaryId !== id)} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.header { padding-top: 4px; }
	.page-title {
		font-family: var(--font-display);
		font-size: clamp(1.7rem, 5vw, 2.3rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-strong);
		line-height: 1.05;
	}
	.page-sub {
		font-size: 0.92rem;
		color: var(--text-muted);
		margin-top: 6px;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 6px 6px 6px 14px;
		transition: border-color 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
	}
	.search-bar:focus-within {
		border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 12%, transparent);
	}
	.search-ic { color: var(--text-faint); display: flex; flex-shrink: 0; }
	.search-input {
		flex: 1;
		padding: 8px 4px;
		font-size: 0.95rem;
		color: var(--text-strong);
		background: transparent;
		border: none;
		outline: none;
	}
	.search-input::placeholder { color: var(--text-faint); }
	.search-btn {
		flex-shrink: 0;
		padding: 9px 18px;
		border-radius: var(--r-sm);
		background: var(--color-brand);
		color: #0a0e17;
		border: none;
		font-family: var(--font-sans);
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s var(--ease-spring);
	}
	.search-btn:hover { background: var(--color-brand-bright); }
	.search-btn:active { transform: scale(0.96); }

	.filter-bar {
		display: flex;
		gap: 8px;
		align-items: center;
		overflow-x: auto;
		padding: 2px 0;
	}
	.filter-chip {
		flex-shrink: 0;
		padding: 9px 16px;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--color-surface);
		border: 1px solid var(--line);
		text-decoration: none;
		transition: all 0.15s var(--ease-out);
		white-space: nowrap;
	}
	.filter-chip:hover {
		color: var(--text-strong);
		border-color: var(--line-strong);
	}
	.filter-chip.active {
		color: #0a0e17;
		background: var(--color-brand);
		border-color: var(--color-brand);
	}

	.filter-divider {
		width: 1px;
		align-self: stretch;
		background: var(--line-strong);
		margin: 4px 4px;
		flex-shrink: 0;
	}

	.dropdown-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.filter-select {
		flex: 1;
		min-width: 130px;
		padding: 10px 14px;
		border-radius: var(--r-sm);
		font-family: var(--font-sans);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		background: var(--color-surface);
		border: 1px solid var(--line);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.filter-select:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-brand) 45%, transparent);
	}
	.filter-select option { background: var(--color-surface-2); color: var(--text); }

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 18px;
	}
	@media (max-width: 640px) {
		.grid { grid-template-columns: 1fr; }
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		padding: 56px 16px;
		border-radius: var(--r-lg);
		border: 1px dashed var(--line-strong);
		color: var(--text-faint);
		font-size: 0.95rem;
	}
</style>
