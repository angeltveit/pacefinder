<script lang="ts">
	import Icon from './Icon.svelte';
	import TopoArt from './TopoArt.svelte';
	import {
		categoryTheme,
		categoryBadge,
		distanceLabel,
		formatDate,
		shortDate,
		daysUntil,
		proxyImage
	} from '$lib/theme';

	interface EventDistance {
		id: string;
		distanceKm: number | null;
		registrationUrl: string | null;
	}

	interface RaceEvent {
		eventName: string;
		category: string;
		city: string;
		country: string;
		raceDate: string | null;
		medalStatus: string;
		registrationStatus: string;
		websiteUrl: string | null;
		imageUrl: string | null;
		whyItFits: string | null;
		interestedCount: number;
		commentCount: number;
		myStatus: string | null;
		distances: EventDistance[];
		primaryId: string;
	}

	interface Props {
		event: RaceEvent;
		user: { id: string; role: string } | null;
		onDelete?: (id: string) => void;
		index?: number;
	}

	let { event, user, index = 0 }: Props = $props();
	let tracked = $state(event.myStatus === 'interested' || event.myStatus === 'attending');
	let pop = $state(false);
	let imgOk = $state(!!event.imageUrl);

	const theme = $derived(categoryTheme(event.category));
	const imgSrc = $derived(proxyImage(event.imageUrl));
	const maxKm = $derived(Math.max(0, ...event.distances.map((d) => d.distanceKm ?? 0)));
	const badge = $derived(categoryBadge(event.category, maxKm));
	const hasMedal = $derived(event.medalStatus === 'confirmed' || event.medalStatus === 'likely');
	const dateChip = $derived(shortDate(event.raceDate));
	const until = $derived(daysUntil(event.raceDate));
	const closingSoon = $derived(
		event.registrationStatus === 'open' && until !== null && until > 0 && until <= 30
	);
	const uniqueDistances = $derived(
		[...new Set(event.distances.map((d) => d.distanceKm))]
			.sort((a, b) => (a ?? 0) - (b ?? 0))
			.slice(0, 4)
	);

	async function toggleTrack(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const newStatus = tracked ? null : 'interested';
		tracked = !tracked;
		if (tracked) {
			pop = true;
			setTimeout(() => (pop = false), 420);
		}
		await fetch(`/api/races/${event.primaryId}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: newStatus })
		});
	}
</script>

<article
	class="card pf-rise"
	style="--accent:{theme.color}; --soft:{theme.soft}; animation-delay:{Math.min(index, 8) * 45}ms;"
>
	<a href="/races/{event.primaryId}" class="card-link">
		<div class="media">
			{#if imgOk && imgSrc}
				<img
					src={imgSrc}
					alt={event.eventName}
					class="media-img"
					loading="lazy"
					onerror={() => (imgOk = false)}
				/>
				<div class="media-scrim"></div>
			{:else}
				<TopoArt seed={event.primaryId} color={theme.color} />
			{/if}

			<!-- top row: category + date -->
			<div class="media-top">
				<span class="cat-pill"><Icon name={theme.icon as never} size={13} /> {badge}</span>
				{#if dateChip}
					<span class="date-pill">
						<strong>{dateChip.day}</strong>
						<small>{dateChip.month}</small>
					</span>
				{/if}
			</div>

			<!-- bottom row: medal + closing soon -->
			<div class="media-bottom">
				{#if hasMedal}
					<span class="tag tag-medal">
						<Icon name="medal" size={13} />
						{event.medalStatus === 'confirmed' ? 'Medal' : 'Medal likely'}
					</span>
				{/if}
				{#if closingSoon}
					<span class="tag tag-urgent">
						<Icon name="flame" size={13} fill /> Closes in {until}d
					</span>
				{:else if event.registrationStatus === 'open'}
					<span class="tag tag-open"><span class="dot"></span> Open</span>
				{/if}
			</div>
		</div>

		<div class="body">
			<h3 class="title">{event.eventName}</h3>
			<p class="meta">
				<Icon name="map-pin" size={14} />
				{event.city}{event.country !== 'NO' ? `, ${event.country}` : ''}
				<span class="sep">·</span>
				<Icon name="calendar" size={14} />
				{formatDate(event.raceDate)}
			</p>

			<div class="dist-row">
				{#each uniqueDistances as km}
					<span class="dist">{distanceLabel(km)}</span>
				{/each}
			</div>

			{#if event.whyItFits}
				<p class="verdict">{event.whyItFits}</p>
			{/if}
		</div>
	</a>

	<div class="actions">
		<button class="btn-track {tracked ? 'is-tracked' : ''} {pop ? 'pop' : ''}" onclick={toggleTrack}>
			<Icon name="heart" size={16} fill={tracked} />
			{tracked ? 'Tracking' : 'Track'}
			{#if event.interestedCount > 0}
				<span class="count">{event.interestedCount}</span>
			{/if}
		</button>
		{#if event.websiteUrl}
			<a
				href={event.websiteUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="btn-site"
				onclick={(e) => e.stopPropagation()}
			>
				Register <Icon name="external" size={15} />
			</a>
		{:else}
			<a href="/races/{event.primaryId}" class="btn-site ghost">
				Details <Icon name="arrow-right" size={15} />
			</a>
		{/if}
	</div>
</article>

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border-radius: var(--r-lg);
		overflow: hidden;
		border: 1px solid var(--line);
		transition:
			transform 0.25s var(--ease-out),
			box-shadow 0.3s var(--ease-out),
			border-color 0.25s var(--ease-out);
	}
	.card:hover {
		transform: translateY(-4px);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.5),
			0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.card-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}

	/* ── Media ── */
	.media {
		position: relative;
		height: 168px;
		overflow: hidden;
	}
	.media-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.4s var(--ease-out);
	}
	.card:hover .media-img {
		transform: scale(1.05);
	}
	.media-scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(10, 14, 23, 0.05) 30%, rgba(10, 14, 23, 0.78) 100%);
	}
	.media-top,
	.media-bottom {
		position: absolute;
		left: 12px;
		right: 12px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.media-top {
		top: 12px;
		justify-content: space-between;
	}
	.media-bottom {
		bottom: 12px;
		flex-wrap: wrap;
	}

	.cat-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 11px;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--accent);
		background: rgba(10, 14, 23, 0.6);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		backdrop-filter: blur(8px);
	}
	.date-pill {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		line-height: 1;
		min-width: 46px;
		padding: 6px 8px;
		border-radius: 12px;
		background: rgba(10, 14, 23, 0.62);
		border: 1px solid var(--line-strong);
		backdrop-filter: blur(8px);
	}
	.date-pill strong {
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 700;
		color: #fff;
	}
	.date-pill small {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin-top: 2px;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		backdrop-filter: blur(8px);
	}
	.tag-medal {
		color: #fde68a;
		background: rgba(251, 191, 36, 0.16);
		border: 1px solid rgba(251, 191, 36, 0.35);
	}
	.tag-open {
		color: #86efac;
		background: rgba(34, 197, 94, 0.16);
		border: 1px solid rgba(34, 197, 94, 0.32);
	}
	.tag-open .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #4ade80;
		box-shadow: 0 0 8px #4ade80;
	}
	.tag-urgent {
		color: #ffd2bf;
		background: rgba(255, 122, 69, 0.2);
		border: 1px solid rgba(255, 122, 69, 0.45);
	}

	/* ── Body ── */
	.body {
		padding: 15px 16px 8px;
	}
	.title {
		font-family: var(--font-display);
		font-size: 1.16rem;
		font-weight: 700;
		color: var(--text-strong);
		line-height: 1.22;
		letter-spacing: -0.01em;
		margin-bottom: 7px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 12px;
	}
	.meta :global(svg) {
		color: var(--text-faint);
	}
	.meta .sep {
		opacity: 0.4;
		margin: 0 2px;
	}

	.dist-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.dist {
		font-size: 0.74rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 8px;
		color: var(--text);
		background: var(--soft);
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
	}

	.verdict {
		font-size: 0.86rem;
		line-height: 1.5;
		color: var(--text);
		padding-left: 11px;
		border-left: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
		margin-bottom: 4px;
	}

	/* ── Actions ── */
	.actions {
		display: flex;
		gap: 8px;
		padding: 8px 16px 16px;
		margin-top: auto;
	}
	.btn-track {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px;
		border-radius: 13px;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
		border: 1.5px solid var(--line-strong);
		cursor: pointer;
		transition: all 0.15s var(--ease-out);
	}
	.btn-track :global(svg) {
		transition: transform 0.2s var(--ease-spring);
	}
	.btn-track:hover {
		background: rgba(255, 255, 255, 0.09);
	}
	.btn-track.is-tracked {
		color: #fb7185;
		background: rgba(244, 63, 94, 0.14);
		border-color: rgba(244, 63, 94, 0.4);
	}
	.btn-track.pop :global(svg) {
		animation: heart-pop 0.42s var(--ease-spring);
	}
	@keyframes heart-pop {
		0% { transform: scale(1); }
		40% { transform: scale(1.45); }
		100% { transform: scale(1); }
	}
	.btn-track .count {
		font-size: 0.74rem;
		padding: 1px 7px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-muted);
	}

	.btn-site {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 12px 18px;
		border-radius: 13px;
		font-size: 0.9rem;
		font-weight: 800;
		color: #0a0e17;
		background: var(--color-brand);
		text-decoration: none;
		cursor: pointer;
		transition: all 0.15s var(--ease-out);
	}
	.btn-site:hover {
		background: var(--color-brand-bright);
		transform: translateY(-1px);
	}
	.btn-site.ghost {
		color: var(--accent);
		background: var(--soft);
		border: 1.5px solid color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.btn-site.ghost:hover {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
</style>
