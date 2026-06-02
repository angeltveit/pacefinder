<script lang="ts">
	import RaceCard from '$lib/components/RaceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	const sections = $derived(
		[
			{
				id: 'upcoming',
				title: 'Upcoming',
				sub: 'Races you’re following that are still ahead',
				icon: 'calendar',
				items: data.upcoming
			},
			{
				id: 'past',
				title: 'Previously ran',
				sub: 'Your race history',
				icon: 'trophy',
				items: data.past
			}
		]
	);

	const total = $derived(data.upcoming.length + data.past.length);
</script>

<svelte:head><title>Followed races — PaceFinder</title></svelte:head>

<section class="head pf-rise">
	<span class="eyebrow"><Icon name="bookmark" size={13} fill /> Your list</span>
	<h1 class="title">Followed races</h1>
	<p class="sub">Everything you’re tracking — upcoming first, then the ones you’ve already run.</p>
</section>

{#if total === 0}
	<div class="empty">
		<Icon name="bookmark" size={28} />
		<p>You’re not following any races yet.</p>
		<a class="empty-cta" href="/races">Explore races <Icon name="arrow-right" size={14} /></a>
	</div>
{:else}
	{#each sections as section (section.id)}
		{#if section.items.length > 0}
			<section class="feed-section">
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
					<span class="sec-count">{section.items.length}</span>
				</header>

				<div class="grid">
					{#each section.items as event, i (event.primaryId + section.id)}
						<RaceCard {event} user={data.user} index={i} />
					{/each}
				</div>
			</section>
		{/if}
	{/each}
{/if}

<style>
	.head {
		text-align: center;
		padding: 32px 0 8px;
		max-width: 720px;
		margin: 0 auto;
	}
	.eyebrow {
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
	.title {
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 5vw, 3rem);
		font-weight: 700;
		line-height: 1.08;
		letter-spacing: -0.03em;
		color: var(--text-strong);
	}
	.sub {
		font-size: 1rem;
		color: var(--text-muted);
		margin: 14px auto 0;
		max-width: 32em;
		text-wrap: balance;
	}

	.feed-section {
		margin-top: 36px;
	}
	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
		width: 36px;
		height: 36px;
		border-radius: 11px;
		color: var(--color-brand-bright);
		background: rgba(196, 240, 66, 0.12);
		border: 1px solid rgba(196, 240, 66, 0.22);
	}
	.sec-ic-past {
		color: var(--text-muted);
		background: rgba(255, 255, 255, 0.04);
		border-color: var(--line);
	}
	.sec-title h2 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-strong);
		letter-spacing: -0.02em;
	}
	.sec-title p {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 1px;
	}
	.sec-count {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-muted);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--line);
		padding: 4px 11px;
		border-radius: 999px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 18px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		padding: 64px 20px;
		color: var(--text-muted);
	}
	.empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		color: #0a0e17;
		background: var(--color-brand);
		padding: 9px 18px;
		border-radius: 10px;
		text-decoration: none;
	}
</style>
