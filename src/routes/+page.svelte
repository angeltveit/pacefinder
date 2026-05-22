<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';

	let { data } = $props();
	let events = $state(data.events);

	// Derived categories for horizontal scroller
	const localMedals = $derived(events.filter(e => e.category === 'local' && (e.medalStatus === 'confirmed' || e.medalStatus === 'likely')));
	const weekendTrips = $derived(events.filter(e => e.category === 'norway'));
	const bucketList = $derived(events.filter(e => e.category === 'international'));
	const closingSoon = $derived(events.filter(e => e.registrationStatus === 'open'));

	type Section = '' | 'medals' | 'trips' | 'bucket' | 'closing';
	let activeSection = $state<Section>('');

	const sectionEvents = $derived.by(() => {
		switch (activeSection) {
			case 'medals': return localMedals;
			case 'trips': return weekendTrips;
			case 'bucket': return bucketList;
			case 'closing': return closingSoon;
			default: return events;
		}
	});
</script>

<svelte:head><title>PaceFinder — Discover Races</title></svelte:head>

<div class="space-y-8">
	<!-- ═══ Hero ═══ -->
	<div class="hero-section">
		<div class="hero-icon">⚡</div>
		<h1 class="hero-title">
			{events.length} event{events.length !== 1 ? 's' : ''} worth your attention
		</h1>
		<p class="hero-sub">Your race scout found fresh targets this week</p>

		<!-- Summary chips -->
		<div class="hero-chips">
			{#if localMedals.length > 0}
				<button class="hero-chip {activeSection === 'medals' ? 'active' : ''}" onclick={() => activeSection = activeSection === 'medals' ? '' : 'medals'}>
					🏅 {localMedals.length} Medal run{localMedals.length > 1 ? 's' : ''}
				</button>
			{/if}
			{#if weekendTrips.length > 0}
				<button class="hero-chip {activeSection === 'trips' ? 'active' : ''}" onclick={() => activeSection = activeSection === 'trips' ? '' : 'trips'}>
					🧳 {weekendTrips.length} Weekend trip{weekendTrips.length > 1 ? 's' : ''}
				</button>
			{/if}
			{#if bucketList.length > 0}
				<button class="hero-chip {activeSection === 'bucket' ? 'active' : ''}" onclick={() => activeSection = activeSection === 'bucket' ? '' : 'bucket'}>
					✈️ {bucketList.length} Bucket list
				</button>
			{/if}
			{#if closingSoon.length > 0}
				<button class="hero-chip {activeSection === 'closing' ? 'active' : ''}" onclick={() => activeSection = activeSection === 'closing' ? '' : 'closing'}>
					🟢 {closingSoon.length} Open now
				</button>
			{/if}
		</div>
	</div>

	<!-- ═══ Feed ═══ -->
	{#if sectionEvents.length === 0}
		<div class="empty-state">
			<p>No races here yet. Run the agent to discover fresh targets! 🚀</p>
		</div>
	{:else}
		<div class="feed">
			{#each sectionEvents as event (event.primaryId)}
				<RaceCard
					{event}
					user={data.user}
					onDelete={(id: string) => (events = events.filter((e) => e.primaryId !== id))}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.hero-section {
		text-align: center;
		padding: 24px 0 8px;
	}
	.hero-icon {
		font-size: 2.5rem;
		margin-bottom: 8px;
	}
	.hero-title {
		font-size: 1.75rem;
		font-weight: 900;
		color: white;
		line-height: 1.2;
		margin-bottom: 6px;
	}
	.hero-sub {
		font-size: 0.9rem;
		color: #64748b;
		margin-bottom: 20px;
	}

	.hero-chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}
	.hero-chip {
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 0.82rem;
		font-weight: 700;
		color: #94a3b8;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.08);
		cursor: pointer;
		transition: all 0.15s;
	}
	.hero-chip:hover {
		background: rgba(255,255,255,0.1);
		color: white;
	}
	.hero-chip.active {
		background: rgba(163,230,53,0.12);
		border-color: rgba(163,230,53,0.4);
		color: #a3e635;
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
		border: 2px dashed rgba(255,255,255,0.08);
		color: #64748b;
		font-size: 0.95rem;
	}
</style>

