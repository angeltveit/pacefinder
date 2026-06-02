<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CoachChat from '$lib/components/CoachChat.svelte';
	import { daysUntil } from '$lib/theme';

	let { data } = $props();
	let events = $state(data.events);

	type Ev = (typeof events)[number];
	const hasMedal = (e: Ev) => e.medalStatus === 'confirmed' || e.medalStatus === 'likely';
	const isOpen = (e: Ev) => e.registrationStatus === 'open';

	const closingSoon = $derived(
		events
			.filter((e) => {
				const d = daysUntil(e.raceDate);
				return isOpen(e) && d !== null && d > 0 && d <= 45;
			})
			.sort((a, b) => (daysUntil(a.raceDate) ?? 0) - (daysUntil(b.raceDate) ?? 0))
	);
	const medalRuns = $derived(events.filter((e) => e.category === 'local' && hasMedal(e)));
	const weekendTrips = $derived(events.filter((e) => e.category === 'norway'));
	const bucketList = $derived(events.filter((e) => e.category === 'international'));
	const freshFinds = $derived(
		[...events].sort(
			(a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime()
		)
	);

	const sections = $derived(
		[
			{
				id: 'closing',
				title: 'Closing soon',
				sub: 'Lock these in before registration shuts',
				icon: 'flame',
				items: closingSoon
			},
			{
				id: 'medals',
				title: 'Medal runs near you',
				sub: 'Finish-line bling guaranteed',
				icon: 'medal',
				items: medalRuns
			},
			{
				id: 'trips',
				title: 'Worth the trip',
				sub: 'Nordic weekenders & destination races',
				icon: 'mountain',
				items: weekendTrips
			},
			{
				id: 'bucket',
				title: 'Bucket list',
				sub: 'The races worth crossing borders for',
				icon: 'plane',
				items: bucketList
			},
			{
				id: 'fresh',
				title: 'Just discovered',
				sub: 'Fresh finds from your race scout',
				icon: 'sparkles',
				items: freshFinds
			}
		].filter((s) => s.items.length > 0)
	);

	const stats = $derived([
		{ icon: 'flame', label: 'Closing soon', value: closingSoon.length },
		{ icon: 'medal', label: 'Medal runs', value: medalRuns.length },
		{ icon: 'mountain', label: 'Weekend trips', value: weekendTrips.length },
		{ icon: 'plane', label: 'Bucket list', value: bucketList.length }
	]);

	const cap = 8;
</script>

<svelte:head><title>PaceFinder — Discover Races</title></svelte:head>

{#if data.coachEnabled}
	<CoachChat gender={data.coachGender as never} name={data.user?.name ?? null} />
{/if}

<section class="hero pf-rise">
	<span class="hero-eyebrow"><Icon name="zap" size={13} fill /> Your race coach has been busy</span>
	<h1 class="hero-title">
		<span class="num">{events.length}</span>
		{events.length === 1 ? 'race' : 'races'} worth your attention
	</h1>
	<p class="hero-sub">Hand-picked upcoming runs across the Nordics — and a few worth flying for.</p>

	<div class="stat-strip">
		{#each stats as s}
			<a href="/races" class="stat">
				<span class="stat-ic"><Icon name={s.icon as never} size={16} /></span>
				<span class="stat-val">{s.value}</span>
				<span class="stat-lab">{s.label}</span>
			</a>
		{/each}
	</div>
</section>

{#if events.length === 0}
	<div class="empty">
		<Icon name="search" size={28} />
		<p>No races yet. Run the scout to discover fresh targets.</p>
	</div>
{:else}
	{#each sections as section, si (section.id)}
		<section class="feed-section" style="animation-delay:{si * 60}ms">
			<header class="sec-head">
				<div class="sec-title">
					<span class="sec-ic sec-ic-{section.id}"
						><Icon name={section.icon as never} size={16} /></span
					>
					<div>
						<h2>{section.title}</h2>
						<p>{section.sub}</p>
					</div>
				</div>
				{#if section.items.length > cap}
					<a class="see-all" href="/races">See all <Icon name="arrow-right" size={14} /></a>
				{/if}
			</header>

			<div class="grid">
				{#each section.items.slice(0, cap) as event, i (event.primaryId + section.id)}
					<RaceCard {event} user={data.user} index={i} />
				{/each}
			</div>
		</section>
	{/each}
{/if}

<style>
	/* ── Hero ── */
	.hero {
		text-align: center;
		padding: 32px 0 8px;
		max-width: 720px;
		margin: 0 auto;
	}
	.hero-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-brand);
		background: rgba(196, 240, 66, 0.1);
		border: 1px solid rgba(196, 240, 66, 0.22);
		padding: 6px 13px;
		border-radius: 999px;
		margin-bottom: 18px;
	}
	.hero-title {
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 5vw, 3rem);
		font-weight: 700;
		line-height: 1.08;
		letter-spacing: -0.03em;
		color: var(--text-strong);
		text-wrap: balance;
	}
	.hero-title .num {
		color: var(--color-brand);
	}
	.hero-sub {
		font-size: 1rem;
		color: var(--text-muted);
		margin: 14px auto 0;
		max-width: 30em;
		text-wrap: balance;
	}

	.stat-strip {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin-top: 26px;
	}
	.stat {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 15px;
		border-radius: 14px;
		background: var(--color-surface);
		border: 1px solid var(--line);
		text-decoration: none;
		transition: all 0.15s var(--ease-out);
	}
	.stat:hover {
		border-color: var(--line-strong);
		transform: translateY(-2px);
	}
	.stat-ic {
		color: var(--color-brand);
		display: grid;
		place-items: center;
	}
	.stat-val {
		font-family: var(--font-display);
		font-weight: 700;
		color: var(--text-strong);
		font-size: 1.05rem;
	}
	.stat-lab {
		font-size: 0.82rem;
		color: var(--text-muted);
	}

	/* ── Sections ── */
	.feed-section {
		margin-top: 44px;
		animation: pf-rise 0.5s var(--ease-out) both;
	}
	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}
	.sec-title {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.sec-ic {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		color: var(--text-strong);
		flex-shrink: 0;
	}
	.sec-ic-closing {
		background: rgba(255, 122, 69, 0.16);
		color: #ff9a73;
	}
	.sec-ic-medals {
		background: rgba(251, 191, 36, 0.16);
		color: #fbbf24;
	}
	.sec-ic-trips {
		background: rgba(167, 139, 250, 0.16);
		color: #a78bfa;
	}
	.sec-ic-bucket {
		background: rgba(251, 191, 36, 0.14);
		color: #fcd34d;
	}
	.sec-ic-fresh {
		background: rgba(196, 240, 66, 0.16);
		color: var(--color-brand);
	}
	.sec-title h2 {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text-strong);
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.sec-title p {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin-top: 2px;
	}
	.see-all {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.15s;
	}
	.see-all:hover {
		color: var(--color-brand);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 18px;
	}

	/* ── Empty ── */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 80px 20px;
		color: var(--text-faint);
		text-align: center;
	}

	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
			gap: 14px;
		}
		.sec-title p {
			display: none;
		}
	}
</style>

