<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CoachChat from '$lib/components/CoachChat.svelte';
	import { daysUntil } from '$lib/theme';

	let { data } = $props();
	let events = $state(data.events);
	const prefs = $derived(data.prefs);
	const personalized = $derived(prefs.hasHome || prefs.targetDistances.length > 0);

	// Keep local state in sync when SvelteKit re-runs the load (e.g. after saving prefs).
	$effect(() => { events = data.events; });

	type Ev = (typeof events)[number];
	const hasMedal = (e: Ev) => e.medalStatus === 'confirmed' || e.medalStatus === 'likely';
	const isOpen = (e: Ev) => e.registrationStatus === 'open';

	// Build all sections in one pass with a shared `seen` set so each event
	// appears in exactly ONE section — its highest-priority bucket.
	const { sections, stats } = $derived.by(() => {
		const seen = new Set<string>();

		/** Pull up to `limit` unseen events from `pool`, marking them seen. */
		function take(pool: Ev[], limit = Infinity): Ev[] {
			const out: Ev[] = [];
			for (const e of pool) {
				if (seen.has(e.primaryId)) continue;
				seen.add(e.primaryId);
				out.push(e);
				if (out.length >= limit) break;
			}
			return out;
		}

		const byScore = [...events].sort((a, b) => b.score - a.score);
		const byDate  = [...events].sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());

		const result: { id: string; title: string; sub: string; icon: string; items: Ev[] }[] = [];

		if (personalized) {
			// When the user has a home location, respect their travel radius as a hard filter
			// across ALL local sections. Only the Bucket list deliberately shows far events.
			const withinRadius = (e: Ev) =>
				!prefs.hasHome || (e.distanceFromHome != null && e.distanceFromHome <= prefs.travelRadiusKm);

			const localByScore = byScore.filter(withinRadius);

			// 1. Top picks — best 12 within radius (score drives order)
			const top = take(localByScore, 12);
			if (top.length) result.push({ id: 'top', title: 'Top picks for you', sub: 'Ranked by distance from you, your distances and timing', icon: 'sparkles', items: top });

			// 2. Near you — races within travel radius, sorted nearest first
			if (prefs.hasHome) {
				const near = take(
					events
						.filter(withinRadius)
						.sort((a, b) => (a.distanceFromHome ?? 0) - (b.distanceFromHome ?? 0))
				);
				if (near.length) result.push({
					id: 'near', title: 'Near you',
					sub: prefs.city ? `Within ${prefs.travelRadiusKm} km of ${prefs.city}` : `Within ${prefs.travelRadiusKm} km of home`,
					icon: 'route', items: near
				});
			}

			// 3. Your distances — races within radius matching favourite distance types
			if (prefs.targetDistances.length > 0) {
				const dist = take(localByScore.filter((e) => e.matchesTarget));
				if (dist.length) result.push({ id: 'distances', title: 'Your distances', sub: 'Races at the lengths you love', icon: 'zap', items: dist });
			}

			// 4. Closing soon — open registrations within radius ending within 45 days
			const closing = take(
				events
					.filter((e) => { const d = daysUntil(e.raceDate); return withinRadius(e) && isOpen(e) && d != null && d > 0 && d <= 45; })
					.sort((a, b) => (daysUntil(a.raceDate) ?? 0) - (daysUntil(b.raceDate) ?? 0))
			);
			if (closing.length) result.push({ id: 'closing', title: 'Closing soon', sub: 'Lock these in before registration shuts', icon: 'flame', items: closing });

			// 5. Bucket list — explicitly far/international (outside radius or >600 km)
			const bucket = take(
				events
					.filter((e) => e.category === 'international' || (e.distanceFromHome ?? 0) > 600)
					.sort((a, b) => b.score - a.score)
			);
			if (bucket.length) result.push({ id: 'bucket', title: 'Bucket list', sub: 'The races worth crossing borders for', icon: 'plane', items: bucket });

			// 6. Anything local not yet surfaced, capped at 8
			const rest = take(localByScore, 8);
			if (rest.length) result.push({ id: 'fresh', title: 'More nearby', sub: 'Other races within your range', icon: 'search', items: rest });

		} else {
			// Non-personalised curation
			const closing = take(
				events
					.filter((e) => { const d = daysUntil(e.raceDate); return isOpen(e) && d != null && d > 0 && d <= 45; })
					.sort((a, b) => (daysUntil(a.raceDate) ?? 0) - (daysUntil(b.raceDate) ?? 0))
			);
			if (closing.length) result.push({ id: 'closing', title: 'Closing soon', sub: 'Lock these in before registration shuts', icon: 'flame', items: closing });

			const popular = take(
				events.filter((e) => e.interestedCount > 0).sort((a, b) => b.interestedCount - a.interestedCount)
			);
			if (popular.length) result.push({ id: 'popular', title: 'Popular right now', sub: 'Races other runners are eyeing', icon: 'users', items: popular });

			const medals = take(events.filter((e) => hasMedal(e)));
			if (medals.length) result.push({ id: 'medals', title: 'Medal runs', sub: 'Finish-line bling guaranteed', icon: 'medal', items: medals });

			const bucket = take(events.filter((e) => e.category === 'international'));
			if (bucket.length) result.push({ id: 'bucket', title: 'Bucket list', sub: 'The races worth crossing borders for', icon: 'plane', items: bucket });

			const fresh = take(byDate, 12);
			if (fresh.length) result.push({ id: 'fresh', title: 'Just discovered', sub: 'Fresh finds from your race scout', icon: 'sparkles', items: fresh });
		}

		// Compute stats from the raw (pre-dedup) derived counts
		const nearCount  = prefs.hasHome ? events.filter((e) => e.distanceFromHome != null && e.distanceFromHome <= prefs.travelRadiusKm).length : 0;
		const distCount  = events.filter((e) => e.matchesTarget && (!prefs.hasHome || (e.distanceFromHome != null && e.distanceFromHome <= prefs.travelRadiusKm))).length;
		const closeCount = events.filter((e) => { const d = daysUntil(e.raceDate); return isOpen(e) && d != null && d > 0 && d <= 45; }).length;
		const bucketRaw  = events.filter((e) => e.category === 'international' || (e.distanceFromHome ?? 0) > 600).length;
		const medalCount = events.filter((e) => hasMedal(e)).length;
		const popCount   = events.filter((e) => e.interestedCount > 0).length;

		const stats = personalized
			? [
					{ icon: 'route', label: 'Near you',       value: nearCount },
					{ icon: 'zap',   label: 'Your distances', value: distCount },
					{ icon: 'flame', label: 'Closing soon',   value: closeCount },
					{ icon: 'plane', label: 'Bucket list',    value: bucketRaw }
				]
			: [
					{ icon: 'flame', label: 'Closing soon', value: closeCount },
					{ icon: 'medal', label: 'Medal runs',   value: medalCount },
					{ icon: 'users', label: 'Popular',      value: popCount },
					{ icon: 'plane', label: 'Bucket list',  value: bucketRaw }
				];

		return { sections: result, stats };
	});

	const cap = 8;
</script>

<svelte:head><title>PaceFinder — Discover Races</title></svelte:head>

{#if data.coachEnabled}
	<CoachChat gender={data.coachGender as never} name={data.user?.name ?? null} />
{/if}

<section class="hero pf-rise">
	<span class="hero-eyebrow">
		<Icon name="zap" size={13} fill />
		{personalized ? 'Tuned to your runs' : 'Your race coach has been busy'}
	</span>
	<h1 class="hero-title">
		<span class="num">{events.length}</span>
		{events.length === 1 ? 'race' : 'races'} worth your attention
	</h1>
	<p class="hero-sub">
		{#if personalized && prefs.city}
			Personalized for {prefs.city} — closest, most relevant runs first.
		{:else}
			Hand-picked upcoming runs across the Nordics — and a few worth flying for.
		{/if}
	</p>

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

{#if data.user && !personalized}
	<a href="/profile" class="personalize-cta pf-rise">
		<span class="pc-ic"><Icon name="route" size={18} /></span>
		<span class="pc-text">
			<strong>Make this feed yours.</strong>
			Set your location and favourite distances to see the closest, most relevant races first.
		</span>
		<Icon name="arrow-right" size={16} />
	</a>
{/if}

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

	/* ── Personalize prompt ── */
	.personalize-cta {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 22px auto 0;
		max-width: 640px;
		padding: 16px 18px;
		border-radius: 16px;
		background: rgba(196, 240, 66, 0.07);
		border: 1px solid rgba(196, 240, 66, 0.25);
		text-decoration: none;
		color: var(--text-strong);
		transition: all 0.15s var(--ease-out);
	}
	.personalize-cta:hover {
		background: rgba(196, 240, 66, 0.12);
		transform: translateY(-2px);
	}
	.pc-ic {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 38px;
		height: 38px;
		border-radius: 11px;
		background: rgba(196, 240, 66, 0.15);
		color: var(--color-brand);
	}
	.pc-text {
		flex: 1;
		font-size: 0.88rem;
		color: var(--text-muted);
		line-height: 1.4;
	}
	.pc-text strong {
		color: var(--text-strong);
		display: block;
		margin-bottom: 2px;
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

