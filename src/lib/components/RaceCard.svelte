<script lang="ts">
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
	}

	let { event, user, onDelete }: Props = $props();
	let tracked = $state(event.myStatus === 'interested');

	// ── Color palette per card (deterministic from id) ─────────────────────
	const CARD_COLORS = [
		{ bg: 'linear-gradient(135deg, #6366f1, #4338ca)', accent: '#a5b4fc', glow: 'rgba(99,102,241,0.3)' },
		{ bg: 'linear-gradient(135deg, #f97316, #c2410c)', accent: '#fed7aa', glow: 'rgba(249,115,22,0.3)' },
		{ bg: 'linear-gradient(135deg, #06b6d4, #0e7490)', accent: '#a5f3fc', glow: 'rgba(6,182,212,0.3)' },
		{ bg: 'linear-gradient(135deg, #ec4899, #be185d)', accent: '#fbcfe8', glow: 'rgba(236,72,153,0.3)' },
		{ bg: 'linear-gradient(135deg, #10b981, #047857)', accent: '#a7f3d0', glow: 'rgba(16,185,129,0.3)' },
		{ bg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', accent: '#ddd6fe', glow: 'rgba(139,92,246,0.3)' },
		{ bg: 'linear-gradient(135deg, #f59e0b, #b45309)', accent: '#fde68a', glow: 'rgba(245,158,11,0.3)' },
		{ bg: 'linear-gradient(135deg, #ef4444, #b91c1c)', accent: '#fecaca', glow: 'rgba(239,68,68,0.3)' },
	];

	function hash(s: string): number {
		let h = 0;
		for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
		return h;
	}

	// ── Route squiggle path ───────────────────────────────────────────────
	function routePath(id: string): string {
		const h = hash(id);
		const sy = 55 + (h % 25);
		const c1x = 55 + ((h >> 3) % 45);
		const c1y = 20 + ((h >> 6) % 30);
		const c2x = 170 + ((h >> 9) % 60);
		const c2y = 65 + ((h >> 12) % 25);
		const ey = 35 + ((h >> 15) % 30);
		return `M 10 ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, 290 ${ey}`;
	}

	// ── Category label ────────────────────────────────────────────────────
	function categoryLabel(cat: string, distances: EventDistance[]): string {
		const maxKm = Math.max(...distances.map(d => d.distanceKm ?? 0));
		if (cat === 'local' && maxKm >= 42) return '🏆 Local Legend';
		if (cat === 'local' && maxKm >= 21) return '💪 Local Flex';
		if (cat === 'local') return '🏃 Local Hit';
		if (cat === 'norway' && maxKm >= 42) return '🗻 Epic Norway';
		if (cat === 'norway') return '🧳 Weekend Trip';
		return '✈️ Bucket List';
	}

	// ── Distance label ────────────────────────────────────────────────────
	function distanceLabel(km: number | null): string {
		if (!km) return '?';
		if (km >= 42 && km <= 43) return 'Marathon';
		if (km >= 21 && km <= 22) return 'Half';
		if (km === Math.round(km)) return `${Math.round(km)}K`;
		return `${km}K`;
	}

	function formatDate(d: string | null): string {
		if (!d) return 'TBA';
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	function regChip(status: string): { text: string; cls: string } | null {
		if (status === 'open') return { text: '🟢 Open', cls: 'reg-open' };
		if (status === 'opening_soon') return { text: '⏰ Soon', cls: 'reg-soon' };
		if (status === 'closed') return { text: '🔒 Closed', cls: 'reg-closed' };
		return null;
	}

	async function toggleTrack(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const newStatus = tracked ? null : 'interested';
		tracked = !tracked;
		await fetch(`/api/races/${event.primaryId}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: newStatus })
		});
	}

	const palette = $derived(CARD_COLORS[hash(event.primaryId) % CARD_COLORS.length]);
	const path = $derived(routePath(event.primaryId));
	const catLabel = $derived(categoryLabel(event.category, event.distances));
	const reg = $derived(regChip(event.registrationStatus));
	const hasMedal = $derived(event.medalStatus === 'confirmed' || event.medalStatus === 'likely');
</script>

<article class="card" style="--glow:{palette.glow};">
	<a href="/races/{event.primaryId}" class="block">
		<!-- ═══ Visual header ═══ -->
		<div class="card-top" style="background:{event.imageUrl ? `url(${event.imageUrl}) center/cover` : palette.bg};">
			{#if event.imageUrl}
				<div class="img-overlay"></div>
			{/if}
			<!-- Route art -->
			<svg class="route-svg" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
				<path d={path} fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 8" />
				<circle cx="10" cy="55" r="5" fill="rgba(255,255,255,0.8)" />
				<circle cx="290" cy="45" r="6" fill={palette.accent} />
			</svg>

			<!-- Distance chips (top-right) -->
			<div class="distance-box">
				{#each event.distances as d}
					<span class="distance-chip">{distanceLabel(d.distanceKm)}</span>
				{/each}
			</div>

			<!-- Medal floater -->
			{#if hasMedal}
				<div class="medal-float">{event.medalStatus === 'confirmed' ? '🏅' : '🥈'}</div>
			{/if}

			<!-- Category pill (bottom-left) -->
			<div class="cat-pill">{catLabel}</div>
		</div>

		<!-- ═══ Card body ═══ -->
		<div class="card-body">
			<h2 class="race-title">{event.eventName}</h2>
			<p class="race-meta">
				📍 {event.city}{event.country !== 'NO' ? `, ${event.country}` : ''} · 📅 {formatDate(event.raceDate)}
			</p>

			<!-- Status chips -->
			<div class="chip-row">
				{#if hasMedal}
					<span class="chip chip-medal">
						{event.medalStatus === 'confirmed' ? '🏅 Medal confirmed' : '🥈 Medal likely'}
					</span>
				{/if}
				{#if reg}
					<span class="chip {reg.cls}">{reg.text}</span>
				{/if}
			</div>

			<!-- Verdict -->
			{#if event.whyItFits}
				<div class="verdict-box">
					<p class="verdict-text">"{event.whyItFits}"</p>
				</div>
			{/if}
		</div>
	</a>

	<!-- ═══ Big action buttons ═══ -->
	<div class="actions">
		<button
			class="btn-track {tracked ? 'is-tracked' : ''}"
			onclick={toggleTrack}
		>
			{tracked ? '❤️ Tracked' : '🤍 Track event'}
		</button>
		{#if event.websiteUrl}
			<a
				href={event.websiteUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="btn-register"
				onclick={(e) => e.stopPropagation()}
			>
				Website →
			</a>
		{/if}
	</div>
</article>

<style>
	.card {
		background: #151a2e;
		border-radius: 1.25rem;
		overflow: hidden;
		border: 1px solid rgba(255,255,255,0.06);
		transition: transform 0.15s ease, box-shadow 0.2s ease;
	}
	.card:active {
		transform: scale(0.98);
	}
	.card:hover {
		box-shadow: 0 16px 48px var(--glow);
	}

	/* ── Top section ── */
	.card-top {
		position: relative;
		height: 150px;
		display: flex;
		align-items: flex-end;
		padding: 14px 16px;
		overflow: hidden;
	}
	.img-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%);
		z-index: 1;
	}
	.route-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0.8;
	}
	.distance-box {
		position: absolute;
		top: 14px;
		right: 14px;
		z-index: 2;
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		justify-content: flex-end;
		max-width: 60%;
	}
	.distance-chip {
		background: rgba(0,0,0,0.55);
		backdrop-filter: blur(10px);
		border: 1.5px solid rgba(255,255,255,0.2);
		border-radius: 999px;
		padding: 5px 12px;
		font-size: 0.82rem;
		font-weight: 800;
		color: white;
		letter-spacing: -0.01em;
		line-height: 1;
	}
	.medal-float {
		position: absolute;
		top: 12px;
		left: 14px;
		z-index: 2;
		font-size: 2rem;
		filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));
		animation: bounce-soft 2s ease-in-out infinite;
	}
	@keyframes bounce-soft {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-4px); }
	}
	.cat-pill {
		position: relative;
		z-index: 2;
		background: rgba(0,0,0,0.5);
		backdrop-filter: blur(8px);
		border-radius: 999px;
		padding: 5px 14px;
		font-size: 0.78rem;
		font-weight: 700;
		color: rgba(255,255,255,0.92);
	}

	/* ── Body ── */
	.card-body {
		padding: 16px 16px 10px;
	}
	.race-title {
		font-size: 1.15rem;
		font-weight: 800;
		color: white;
		line-height: 1.25;
		margin-bottom: 4px;
	}
	.race-meta {
		font-size: 0.82rem;
		color: #64748b;
		margin-bottom: 12px;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.chip {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid;
	}
	.chip-medal {
		color: #fde68a;
		background: rgba(245,158,11,0.12);
		border-color: rgba(245,158,11,0.3);
	}
	.reg-open {
		color: #86efac;
		background: rgba(34,197,94,0.12);
		border-color: rgba(34,197,94,0.3);
	}
	.reg-soon {
		color: #fde047;
		background: rgba(234,179,8,0.12);
		border-color: rgba(234,179,8,0.3);
	}
	.reg-closed {
		color: #94a3b8;
		background: rgba(100,116,139,0.1);
		border-color: rgba(100,116,139,0.2);
	}

	.verdict-box {
		padding: 12px 14px;
		border-radius: 12px;
		background: rgba(255,255,255,0.03);
		border-left: 3px solid rgba(163,230,53,0.5);
	}
	.verdict-text {
		font-size: 0.85rem;
		color: #cbd5e1;
		font-style: italic;
		line-height: 1.5;
	}

	/* ── Actions ── */
	.actions {
		display: flex;
		gap: 8px;
		padding: 8px 16px 16px;
		align-items: stretch;
	}
	.btn-track {
		flex: 1;
		padding: 14px;
		border-radius: 14px;
		font-size: 0.95rem;
		font-weight: 700;
		color: white;
		background: rgba(255,255,255,0.07);
		border: 1.5px solid rgba(255,255,255,0.1);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-track:hover {
		background: rgba(255,255,255,0.12);
		border-color: rgba(255,255,255,0.2);
	}
	.btn-track.is-tracked {
		background: rgba(244,63,94,0.14);
		border-color: rgba(244,63,94,0.4);
		color: #fb7185;
	}

	.btn-register {
		padding: 14px 22px;
		border-radius: 14px;
		font-size: 0.95rem;
		font-weight: 800;
		color: #0c0f1a;
		background: #a3e635;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.15s;
		display: flex;
		align-items: center;
	}
	.btn-register:hover {
		background: #bef264;
	}

	.btn-admin {
		padding: 12px;
		border-radius: 12px;
		font-size: 0.9rem;
		background: transparent;
		border: 1px solid rgba(255,255,255,0.06);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-admin:hover { background: rgba(239,68,68,0.12); }
	.btn-admin:disabled { opacity: 0.3; }
</style>
