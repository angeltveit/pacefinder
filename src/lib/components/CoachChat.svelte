<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import Icon from '$lib/components/Icon.svelte';
	import { pickWelcome, loadingTexts, type CoachGender } from '$lib/coach/coachText';

	type RaceRef = {
		id: string;
		name: string;
		city: string | null;
		country: string | null;
		category: string;
		distanceKm: number | null;
		date: string | null;
	};
	type Msg = {
		role: 'user' | 'assistant';
		content: string;
		races?: RaceRef[];
	};

	let { gender, name }: { gender: CoachGender; name: string | null } = $props();

	let messages = $state<Msg[]>([]);
	let input = $state('');
	let loading = $state(false);
	let loadingText = $state(loadingTexts[0]);
	let scroller = $state<HTMLDivElement>();
	let inputEl = $state<HTMLTextAreaElement>();
	let loadingTimer: ReturnType<typeof setInterval> | undefined;

	// ── Consent-based geolocation for "near me" queries ──
	let coords = $state<{ lat: number; lng: number } | null>(null);
	let geoStatus = $state<'idle' | 'pending' | 'granted' | 'denied' | 'unsupported'>('idle');
	const NEAR_RE = /\b(near|nearby|close to|around|by me|in my area|my area|near me)\b/i;

	function requestLocation(): Promise<{ lat: number; lng: number } | null> {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			geoStatus = 'unsupported';
			return Promise.resolve(null);
		}
		geoStatus = 'pending';
		return new Promise((resolve) => {
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
					geoStatus = 'granted';
					resolve(coords);
				},
				() => {
					geoStatus = 'denied';
					resolve(null);
				},
				{ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
			);
		});
	}

	async function toggleLocation() {
		if (geoStatus === 'granted') {
			coords = null;
			geoStatus = 'idle';
			return;
		}
		await requestLocation();
	}

	onMount(() => {
		messages = [{ role: 'assistant', content: pickWelcome(gender, name) }];
	});

	function startLoadingTicker() {
		loadingText = loadingTexts[Math.floor(Math.random() * loadingTexts.length)];
		loadingTimer = setInterval(() => {
			loadingText = loadingTexts[Math.floor(Math.random() * loadingTexts.length)];
		}, 2200);
	}
	function stopLoadingTicker() {
		if (loadingTimer) clearInterval(loadingTimer);
		loadingTimer = undefined;
	}

	async function scrollToEnd() {
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	async function send() {
		const text = input.trim();
		if (!text || loading) return;
		input = '';
		messages = [...messages, { role: 'user', content: text }];
		loading = true;
		startLoadingTicker();
		await scrollToEnd();

		// If they're asking for races "near me" and we don't have a location yet,
		// ask for consent first so the coach can actually look nearby.
		let loc = coords;
		if (!loc && geoStatus !== 'denied' && NEAR_RE.test(text)) {
			loc = await requestLocation();
		}

		try {
			const payload = messages
				.filter((m) => m.role === 'user' || m.role === 'assistant')
				.map((m) => ({ role: m.role, content: m.content }));
			const res = await fetch('/api/coach', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: payload, location: loc ?? undefined })
			});
			const data = (await res.json()) as {
				reply: string;
				races?: RaceRef[];
			};
			messages = [
				...messages,
				{ role: 'assistant', content: data.reply, races: data.races ?? [] }
			];
			await scrollToEnd();
		} catch {
			messages = [
				...messages,
				{ role: 'assistant', content: 'Connection cramp! 😵 Give it another shot.' }
			];
		} finally {
			loading = false;
			stopLoadingTicker();
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	// Grow the textarea with its content, up to a max height (then scroll).
	function autoGrow() {
		const el = inputEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, 160) + 'px';
	}

	$effect(() => {
		// Re-measure whenever the text changes (covers send() clearing it too).
		input;
		autoGrow();
	});

	// collapsed by default; expands on input focus; stays expanded once a message was sent
	let expanded = $state(false);
	const hasSentMessage = $derived(messages.some((m) => m.role === 'user'));

	function onFocus() {
		expanded = true;
	}
	function onBlur() {
		// Only collapse if the user never actually sent anything
		if (!hasSentMessage) expanded = false;
	}

	const distLabel = (km: number | null) =>
		km == null ? '' : km === 21.1 ? 'Half' : km === 42.2 ? 'Marathon' : `${km}K`;
	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
			: 'Date TBA';
</script>

<section class="coach pf-rise">
	<header class="coach-head">
		<span class="coach-badge">
			<span class="pulse"></span>
			<Icon name="zap" size={14} fill /> Coach
		</span>
		<span class="coach-tag">Your hype-man with a database</span>
	</header>

	{#if expanded || hasSentMessage}
	<div class="coach-body" bind:this={scroller} transition:slide={{ duration: 260 }}>
		{#each messages as m, i (i)}
			<div class="row {m.role}">
				<div class="bubble">
					{m.content}
					{#if m.races && m.races.length > 0}
						<div class="race-list">
							{#each m.races as r (r.id)}
								<a class="race-pill" href={`/races/${r.id}`}>
									<span class="rp-main">{r.name}</span>
									<span class="rp-meta">
										{#if r.distanceKm != null}<span class="rp-km">{distLabel(r.distanceKm)}</span>{/if}
										<span>{r.city ?? ''}</span>
										<span class="rp-dot">·</span>
										<span>{fmtDate(r.date)}</span>
									</span>
									<Icon name="arrow-right" size={14} />
								</a>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}

		{#if loading}
			<div class="row assistant">
				<div class="bubble thinking">
					<span class="dots"><span></span><span></span><span></span></span>
					<span class="think-text">{loadingText}</span>
				</div>
			</div>
		{/if}
	</div>
	{/if}

	<div class="coach-input">
		<button
			class="loc-btn"
			class:active={geoStatus === 'granted'}
			onclick={toggleLocation}
			disabled={loading || geoStatus === 'pending'}
			title={geoStatus === 'granted'
				? 'Location shared — tap to turn off'
				: geoStatus === 'denied'
					? 'Location blocked in your browser'
					: 'Share my location to find races near me'}
			aria-label="Share location"
		>
			<Icon name={geoStatus === 'pending' ? 'search' : 'route'} size={18} />
		</button>
		<textarea
			rows="1"
			placeholder="e.g. Find me a cool 10k within the next month…"
			bind:this={inputEl}
			bind:value={input}
			oninput={autoGrow}
			onkeydown={onKey}
			onfocus={onFocus}
			onblur={onBlur}
			disabled={loading}
		></textarea>
		<button onclick={send} disabled={loading || !input.trim()} aria-label="Send">
			<Icon name="arrow-right" size={18} />
		</button>
	</div>
	{#if geoStatus === 'granted'}
		<p class="loc-status on"><Icon name="check" size={12} /> Location on — I'll hunt down races near you</p>
	{:else if geoStatus === 'denied'}
		<p class="loc-status off">Location blocked. Enable it in your browser to find races near you.</p>
	{/if}
</section>

<style>
	.coach {
		max-width: 760px;
		margin: 24px auto 8px;
		background: linear-gradient(180deg, rgba(196, 240, 66, 0.06), rgba(255, 255, 255, 0.015));
		border: 1px solid rgba(196, 240, 66, 0.2);
		border-radius: 20px;
		overflow: hidden;
		box-shadow: 0 18px 40px -28px rgba(196, 240, 66, 0.5);
	}
	.coach-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.coach-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--color-brand);
		position: relative;
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--color-brand);
		box-shadow: 0 0 0 0 rgba(196, 240, 66, 0.6);
		animation: pulse 1.8s infinite;
	}
	@keyframes pulse {
		0% { box-shadow: 0 0 0 0 rgba(196, 240, 66, 0.55); }
		70% { box-shadow: 0 0 0 9px rgba(196, 240, 66, 0); }
		100% { box-shadow: 0 0 0 0 rgba(196, 240, 66, 0); }
	}
	.coach-tag {
		font-size: 0.78rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
	}
	.coach-body {
		height: 360px;
		max-height: 70vh;
		overflow-y: auto;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	/* Let users drag the chat taller/shorter on desktop. */
	@media (min-width: 700px) and (pointer: fine) {
		.coach-body {
			resize: vertical;
			min-height: 220px;
		}
	}
	.row {
		display: flex;
	}
	.row.user {
		justify-content: flex-end;
	}
	.bubble {
		max-width: 86%;
		padding: 10px 14px;
		border-radius: 16px;
		font-size: 0.92rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}
	.row.assistant .bubble {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.07);
		color: var(--text-strong, #f5f5f5);
		border-top-left-radius: 4px;
	}
	.row.user .bubble {
		background: var(--color-brand);
		color: #15200a;
		font-weight: 500;
		border-top-right-radius: 4px;
	}
	.thinking {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.dots {
		display: inline-flex;
		gap: 4px;
	}
	.dots span {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--color-brand);
		animation: bounce 1.2s infinite ease-in-out;
	}
	.dots span:nth-child(2) { animation-delay: 0.15s; }
	.dots span:nth-child(3) { animation-delay: 0.3s; }
	@keyframes bounce {
		0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
		40% { transform: translateY(-5px); opacity: 1; }
	}
	.think-text {
		font-size: 0.86rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
		font-style: italic;
	}
	.race-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
	}
	.race-pill {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(196, 240, 66, 0.18);
		text-decoration: none;
		color: var(--text-strong, #f5f5f5);
		transition: border-color 0.15s, transform 0.15s;
	}
	.race-pill:hover {
		border-color: var(--color-brand);
		transform: translateX(2px);
	}
	.rp-main {
		font-weight: 600;
		font-size: 0.88rem;
		flex-shrink: 0;
	}
	.rp-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.76rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.55));
		margin-left: auto;
		margin-right: 4px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.rp-km {
		font-weight: 700;
		color: var(--color-brand);
	}
	.rp-dot {
		opacity: 0.5;
	}
	.coach-input {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		padding: 12px 14px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(0, 0, 0, 0.18);
	}
	.coach-input textarea {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 11px 14px;
		color: var(--text-strong, #f5f5f5);
		font-size: 0.92rem;
		font-family: inherit;
		line-height: 1.4;
		outline: none;
		resize: none;
		overflow-y: auto;
		max-height: 160px;
	}
	.coach-input textarea:focus {
		border-color: var(--color-brand);
	}
	.coach-input button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: 12px;
		border: none;
		background: var(--color-brand);
		color: #15200a;
		cursor: pointer;
		transition: opacity 0.15s, transform 0.1s;
	}
	.coach-input button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.coach-input button:not(:disabled):active {
		transform: scale(0.94);
	}
	.loc-btn {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.1s;
	}
	.loc-btn:not(:disabled):hover {
		border-color: var(--color-brand);
		color: var(--color-brand);
	}
	.loc-btn.active {
		background: rgba(196, 240, 66, 0.14);
		border-color: var(--color-brand);
		color: var(--color-brand);
	}
	.loc-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.loc-status {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 0;
		padding: 0 18px 12px;
		font-size: 0.76rem;
	}
	.loc-status.on {
		color: var(--color-brand);
	}
	.loc-status.off {
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
	}
</style>
