<script lang="ts">
	import { untrack } from 'svelte';

	let { data } = $props();

	let commentBody = $state('');
	let submitting = $state(false);
	let comments = $state(untrack(() => data.comments));
	let tracked = $state(untrack(() => data.myStatus === 'interested'));
	let deleting = $state(false);
	let researching = $state(false);
	let researchLog = $state<string[]>([]);

	// ── Color palette (same as RaceCard) ──────────────────────────────────
	const CARD_COLORS = [
		{ bg: 'linear-gradient(135deg, #6366f1, #4338ca)', accent: '#a5b4fc' },
		{ bg: 'linear-gradient(135deg, #f97316, #c2410c)', accent: '#fed7aa' },
		{ bg: 'linear-gradient(135deg, #06b6d4, #0e7490)', accent: '#a5f3fc' },
		{ bg: 'linear-gradient(135deg, #ec4899, #be185d)', accent: '#fbcfe8' },
		{ bg: 'linear-gradient(135deg, #10b981, #047857)', accent: '#a7f3d0' },
		{ bg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', accent: '#ddd6fe' },
		{ bg: 'linear-gradient(135deg, #f59e0b, #b45309)', accent: '#fde68a' },
		{ bg: 'linear-gradient(135deg, #ef4444, #b91c1c)', accent: '#fecaca' },
	];
	function hash(s: string): number {
		let h = 0;
		for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
		return h;
	}
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

	const palette = $derived(CARD_COLORS[hash(data.race.id) % CARD_COLORS.length]);
	const path = $derived(routePath(data.race.id));

	function bigDistance(km: number | null): string {
		if (!km) return '?K';
		if (km >= 42 && km <= 43) return '42.2K';
		if (km >= 21 && km <= 22) return '21.1K';
		if (km === Math.round(km)) return `${Math.round(km)}K`;
		return `${km}K`;
	}

	function categoryLabel(cat: string, km: number | null): string {
		const d = km ?? 0;
		if (cat === 'local' && d >= 42) return '🏆 Local Legend';
		if (cat === 'local' && d >= 21) return '💪 Local Flex';
		if (cat === 'local') return '🏃 Local Hit';
		if (cat === 'norway' && d >= 42) return '🗻 Epic Norway';
		if (cat === 'norway') return '🧳 Weekend Trip';
		return '✈️ Bucket List';
	}

	function formatDate(d: string | null): string {
		if (!d) return 'TBA';
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function medalText(status: string): string | null {
		if (status === 'confirmed') return '🏅 Medal confirmed';
		if (status === 'likely') return '🥈 Medal likely';
		return null;
	}

	function regText(status: string): { text: string; cls: string } | null {
		if (status === 'open') return { text: '🟢 Registration open', cls: 'chip-green' };
		if (status === 'opening_soon') return { text: '⏰ Opens soon', cls: 'chip-yellow' };
		if (status === 'closed') return { text: '🔒 Closed', cls: 'chip-muted' };
		return null;
	}

	async function toggleTrack() {
		const newStatus = tracked ? null : 'interested';
		tracked = !tracked;
		await fetch(`/api/races/${data.race.id}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: newStatus })
		});
	}

	async function submitComment() {
		if (!commentBody.trim()) return;
		submitting = true;
		try {
			const res = await fetch(`/api/races/${data.race.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: commentBody.trim() })
			});
			if (res.ok) {
				const { comment } = await res.json();
				comments = [...comments, { ...comment, authorName: data.user?.name ?? 'You', authorId: data.user?.id, createdAt: new Date().toISOString() }];
				commentBody = '';
			}
		} finally {
			submitting = false;
		}
	}

	async function deleteComment(id: string) {
		if (!confirm('Delete this comment?')) return;
		const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
		if (res.ok) comments = comments.filter((c) => c.id !== id);
	}

	async function deleteRace() {
		if (!confirm(`Delete "${data.race.name}" permanently?`)) return;
		deleting = true;
		const res = await fetch(`/api/races/${data.race.id}`, { method: 'DELETE' });
		if (res.ok) window.location.href = '/races';
		deleting = false;
	}

	async function researchDeeper() {
		researching = true;
		researchLog = ['Starting deep research…'];
		try {
			const res = await fetch(`/api/races/${data.race.id}/enrich`, { method: 'POST' });
			if (res.ok) {
				const result = await res.json();
				researchLog = result.log ?? ['Done!'];
				// Reload page to show updated data
				setTimeout(() => window.location.reload(), 1500);
			} else {
				researchLog = [...researchLog, `Error: ${res.status} ${res.statusText}`];
			}
		} catch (err) {
			researchLog = [...researchLog, `Error: ${err}`];
		} finally {
			researching = false;
		}
	}

	const medal = $derived(medalText(data.race.medalStatus));
	const reg = $derived(regText(data.race.registrationStatus));
	const catLabel = $derived(categoryLabel(data.race.category, data.race.distanceKm));
</script>

<svelte:head><title>{data.race.name} — PaceFinder</title></svelte:head>

<div class="detail-page">
	<!-- Back link -->
	<a href="/races" class="back-link">← Back to races</a>

	<!-- ═══ Hero header ═══ -->
	<div class="hero" style="background:{palette.bg};">
		<svg class="hero-route" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
			<path d={path} fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 8" />
			<circle cx="10" cy="55" r="5" fill="rgba(255,255,255,0.8)" />
			<circle cx="290" cy="45" r="6" fill={palette.accent} />
		</svg>

		<div class="hero-content">
			<div class="hero-distance">{bigDistance(data.race.distanceKm)}</div>
			<div class="hero-cat">{catLabel}</div>
		</div>

		{#if data.race.medalStatus === 'confirmed' || data.race.medalStatus === 'likely'}
			<div class="hero-medal">{data.race.medalStatus === 'confirmed' ? '🏅' : '🥈'}</div>
		{/if}
	</div>

	<!-- ═══ Main content ═══ -->
	<div class="content-card">
		<h1 class="title">{data.race.name}</h1>
		<p class="meta">
			📍 {data.race.city}{data.race.country !== 'NO' ? `, ${data.race.country}` : ''}
			{#if data.race.location && data.race.location !== data.race.city}
				· {data.race.location}
			{/if}
		</p>
		<p class="meta">📅 {formatDate(data.race.raceDate)}</p>

		<!-- Status chips -->
		<div class="chips">
			{#if medal}
				<span class="chip chip-gold">{medal}</span>
			{/if}
			{#if reg}
				<span class="chip {reg.cls}">{reg.text}</span>
			{/if}
			<span class="chip chip-muted">❤️ {data.interestedCount} interested</span>
		</div>

		<!-- Verdict -->
		{#if data.race.whyItFits}
			<div class="verdict">
				<p class="verdict-label">PaceFinder verdict</p>
				<p class="verdict-text">"{data.race.whyItFits}"</p>
			</div>
		{/if}

		<!-- Actions -->
		<div class="actions">
			{#if data.user}
				<button class="btn-track {tracked ? 'is-tracked' : ''}" onclick={toggleTrack}>
					{tracked ? '❤️ Tracked' : '🤍 Track race'}
				</button>
			{/if}
			{#if data.race.registrationUrl}
				<a href={data.race.registrationUrl} target="_blank" rel="noopener noreferrer" class="btn-register">
					Register →
				</a>
			{/if}
		</div>
	</div>

	<!-- Source -->
	{#if data.race.sourceUrl}
		<div class="source-card">
			<span class="source-label">Source:</span>
			<a href={data.race.sourceUrl} target="_blank" rel="noopener noreferrer" class="source-link">
				{data.race.sourceUrl}
			</a>
			<span class="source-date">Found {new Date(data.race.firstSeenAt).toLocaleDateString('en-GB')}</span>
		</div>
	{/if}

	<!-- ═══ Other distances ═══ -->
	{#if data.siblings.length > 0}
		<div class="distances-card">
			<h3 class="distances-title">🏃 Also available at this event</h3>
			<div class="distances-row">
				<a href="/races/{data.race.id}" class="distance-pill active">
					{bigDistance(data.race.distanceKm)}
				</a>
				{#each data.siblings as sib}
					<a href="/races/{sib.id}" class="distance-pill">
						{bigDistance(sib.distanceKm)}
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ═══ Admin tools ═══ -->
	{#if data.user?.role === 'admin'}
		<div class="admin-tools">
			<h3 class="admin-title">🔧 Admin</h3>
			<div class="admin-actions">
				<button class="btn-research" onclick={researchDeeper} disabled={researching}>
					{researching ? '🔬 Researching…' : '🔬 Research deeper'}
				</button>
				<button class="btn-delete" onclick={deleteRace} disabled={deleting}>
					{deleting ? 'Deleting…' : '🗑 Delete race'}
				</button>
			</div>
			{#if researchLog.length > 0}
				<div class="research-log">
					{#each researchLog as line}
						<p class="log-line">{line}</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- ═══ Comments ═══ -->
	<div class="comments-section">
		<h2 class="section-title">
			💬 Comments
			{#if comments.length > 0}
				<span class="comment-count">({comments.length})</span>
			{/if}
		</h2>

		{#each comments as comment (comment.id)}
			<div class="comment-card">
				<div class="comment-header">
					<div class="comment-avatar">{comment.authorName.charAt(0).toUpperCase()}</div>
					<span class="comment-author">{comment.authorName}</span>
					<span class="comment-date">
						{new Date(comment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
					</span>
					{#if data.user?.role === 'admin'}
						<button class="comment-delete" onclick={() => deleteComment(comment.id)}>Delete</button>
					{/if}
				</div>
				<p class="comment-body">{comment.body}</p>
			</div>
		{/each}

		{#if data.user}
			<div class="comment-form">
				<textarea
					bind:value={commentBody}
					placeholder="Add a comment…"
					rows="3"
					class="comment-input"
				></textarea>
				<button
					onclick={submitComment}
					disabled={submitting || !commentBody.trim()}
					class="btn-post"
				>
					{submitting ? 'Posting…' : 'Post comment'}
				</button>
			</div>
		{:else}
			<p class="login-prompt">
				<a href="/login">Log in</a> to leave a comment.
			</p>
		{/if}
	</div>
</div>

<style>
	.detail-page {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.back-link {
		font-size: 0.82rem;
		font-weight: 600;
		color: #64748b;
		text-decoration: none;
		transition: color 0.15s;
	}
	.back-link:hover { color: white; }

	/* ── Hero ── */
	.hero {
		position: relative;
		height: 180px;
		border-radius: 1.25rem;
		overflow: hidden;
		display: flex;
		align-items: flex-end;
		padding: 20px;
	}
	.hero-route {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0.8;
	}
	.hero-content {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hero-distance {
		font-size: 3rem;
		font-weight: 900;
		color: white;
		letter-spacing: -0.03em;
		line-height: 1;
		text-shadow: 0 4px 12px rgba(0,0,0,0.3);
	}
	.hero-cat {
		background: rgba(0,0,0,0.45);
		backdrop-filter: blur(8px);
		border-radius: 999px;
		padding: 5px 14px;
		font-size: 0.8rem;
		font-weight: 700;
		color: rgba(255,255,255,0.9);
		width: fit-content;
	}
	.hero-medal {
		position: absolute;
		top: 16px;
		right: 20px;
		font-size: 2.5rem;
		filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5));
		animation: bounce-soft 2s ease-in-out infinite;
	}
	@keyframes bounce-soft {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-4px); }
	}

	/* ── Content card ── */
	.content-card {
		background: #151a2e;
		border-radius: 1.25rem;
		padding: 20px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.title {
		font-size: 1.5rem;
		font-weight: 900;
		color: white;
		line-height: 1.2;
		margin-bottom: 8px;
	}
	.meta {
		font-size: 0.85rem;
		color: #64748b;
		margin-bottom: 4px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 14px 0;
	}
	.chip {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid;
	}
	.chip-gold {
		color: #fde68a;
		background: rgba(245,158,11,0.12);
		border-color: rgba(245,158,11,0.3);
	}
	.chip-green {
		color: #86efac;
		background: rgba(34,197,94,0.12);
		border-color: rgba(34,197,94,0.3);
	}
	.chip-yellow {
		color: #fde047;
		background: rgba(234,179,8,0.12);
		border-color: rgba(234,179,8,0.3);
	}
	.chip-muted {
		color: #94a3b8;
		background: rgba(100,116,139,0.1);
		border-color: rgba(100,116,139,0.2);
	}

	.verdict {
		padding: 14px 16px;
		border-radius: 14px;
		background: rgba(255,255,255,0.03);
		border-left: 3px solid rgba(163,230,53,0.5);
		margin-bottom: 16px;
	}
	.verdict-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #a3e635;
		margin-bottom: 4px;
	}
	.verdict-text {
		font-size: 0.9rem;
		color: #cbd5e1;
		font-style: italic;
		line-height: 1.5;
	}

	.actions {
		display: flex;
		gap: 10px;
		margin-top: 16px;
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
	.btn-track:hover { background: rgba(255,255,255,0.12); }
	.btn-track.is-tracked {
		background: rgba(244,63,94,0.14);
		border-color: rgba(244,63,94,0.4);
		color: #fb7185;
	}
	.btn-register {
		padding: 14px 24px;
		border-radius: 14px;
		font-size: 0.95rem;
		font-weight: 800;
		color: #0c0f1a;
		background: #a3e635;
		text-decoration: none;
		transition: background 0.15s;
	}
	.btn-register:hover { background: #bef264; }

	/* ── Source ── */
	.source-card {
		background: #151a2e;
		border-radius: 1rem;
		padding: 14px 16px;
		border: 1px solid rgba(255,255,255,0.06);
		font-size: 0.8rem;
		color: #64748b;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.source-label { font-weight: 700; color: #94a3b8; }
	.source-link {
		color: #a3e635;
		text-decoration: none;
		word-break: break-all;
	}
	.source-link:hover { text-decoration: underline; }
	.source-date { color: #475569; }

	/* ── Admin tools ── */
	.admin-tools {
		background: #1a1225;
		border-radius: 1rem;
		padding: 16px;
		border: 1px solid rgba(139, 92, 246, 0.2);
	}
	.admin-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: #a78bfa;
		margin-bottom: 12px;
	}
	.admin-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.btn-research {
		padding: 10px 18px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		background: rgba(139, 92, 246, 0.2);
		color: #c4b5fd;
		transition: background 0.15s;
	}
	.btn-research:hover:not(:disabled) { background: rgba(139, 92, 246, 0.35); }
	.btn-research:disabled { opacity: 0.5; cursor: wait; }
	.btn-delete {
		padding: 10px 18px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		transition: background 0.15s;
	}
	.btn-delete:hover:not(:disabled) { background: rgba(239, 68, 68, 0.3); }
	.btn-delete:disabled { opacity: 0.5; }
	.research-log {
		margin-top: 12px;
		background: rgba(0,0,0,0.3);
		border-radius: 8px;
		padding: 10px 12px;
		max-height: 200px;
		overflow-y: auto;
	}
	.log-line {
		font-size: 0.75rem;
		font-family: monospace;
		color: #94a3b8;
		margin-bottom: 2px;
		white-space: pre-wrap;
	}

	/* ── Comments ── */
	.comments-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.section-title {
		font-size: 1.1rem;
		font-weight: 800;
		color: white;
	}
	.comment-count {
		font-weight: 400;
		color: #64748b;
		font-size: 0.9rem;
	}

	.comment-card {
		background: #151a2e;
		border-radius: 14px;
		padding: 14px 16px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.comment-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.comment-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(163,230,53,0.15);
		border: 1px solid rgba(163,230,53,0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: #a3e635;
	}
	.comment-author {
		font-size: 0.82rem;
		font-weight: 700;
		color: white;
	}
	.comment-date {
		font-size: 0.72rem;
		color: #475569;
	}
	.comment-delete {
		margin-left: auto;
		font-size: 0.72rem;
		color: #f87171;
		background: none;
		border: none;
		cursor: pointer;
		font-weight: 600;
	}
	.comment-delete:hover { color: #ef4444; }
	.comment-body {
		font-size: 0.85rem;
		color: #cbd5e1;
		line-height: 1.5;
	}

	.comment-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.comment-input {
		width: 100%;
		resize: none;
		border-radius: 14px;
		padding: 14px;
		font-size: 0.85rem;
		color: white;
		background: rgba(255,255,255,0.04);
		border: 1.5px solid rgba(255,255,255,0.08);
		outline: none;
		transition: border-color 0.15s;
	}
	.comment-input::placeholder { color: #475569; }
	.comment-input:focus { border-color: rgba(163,230,53,0.4); }

	.btn-post {
		align-self: flex-end;
		padding: 12px 20px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 700;
		color: #0c0f1a;
		background: #a3e635;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-post:hover { background: #bef264; }
	.btn-post:disabled { opacity: 0.4; cursor: default; }

	.login-prompt {
		font-size: 0.85rem;
		color: #64748b;
	}
	.login-prompt a {
		color: #a3e635;
		text-decoration: none;
		font-weight: 600;
	}
	.login-prompt a:hover { text-decoration: underline; }

	/* ── Distances ── */
	.distances-card {
		background: #151a2e;
		border-radius: 1rem;
		padding: 16px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.distances-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: #94a3b8;
		margin-bottom: 12px;
	}
	.distances-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.distance-pill {
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		color: #94a3b8;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.1);
		text-decoration: none;
		transition: all 0.15s;
	}
	.distance-pill:hover {
		color: white;
		border-color: rgba(163,230,53,0.4);
	}
	.distance-pill.active {
		color: #0c0f1a;
		background: #a3e635;
		border-color: #a3e635;
	}
</style>
