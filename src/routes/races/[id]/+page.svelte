<script lang="ts">
	import { untrack } from 'svelte';

	let { data } = $props();

	let commentBody = $state('');
	let submitting = $state(false);
	let comments = $state(untrack(() => data.comments));
	let results = $state(untrack(() => data.results));
	let myStatus = $state(untrack(() => data.myStatus));
	let myBib = $state(untrack(() => data.myBib ?? ''));
	let bibInput = $state(untrack(() => data.myBib ?? ''));
	let savingBib = $state(false);
	let editingBib = $state(!data.myBib); // false = display mode, true = edit mode
	let refreshingResult = $state(false);
	let refreshCooldown = $state(0); // seconds remaining
	let deleting = $state(false);
	let researching = $state(false);
	let fetchingResults = $state(false);
	let researchLog = $state<string[]>([]);
	let bibResults = $state<{ position: number | null; name: string; bibNumber: string | null; finishTime: string; category: string | null; categoryPosition: number | null; club: string | null; distance: string | null }[]>([]);

	// Re-sync local state when navigating between distances (same component, new data)
	let prevRaceId = $state(data.race.id);
	$effect(() => {
		if (data.race.id !== prevRaceId) {
			prevRaceId = data.race.id;
			comments = data.comments;
			results = data.results;
			myStatus = data.myStatus;
			myBib = data.myBib ?? '';
			bibInput = data.myBib ?? '';
			editingBib = !data.myBib;
			bibResults = [];
			bibLookupDone = false;
		}
	});

	// Auto-fetch bib result on page load if user has a bib
	let bibLookupDone = $state(false);
	$effect(() => {
		if (myBib && !bibLookupDone) {
			bibLookupDone = true;
			refreshMyResult();
		}
	});

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

	const isPast = $derived(data.race.raceDate ? new Date(data.race.raceDate) < new Date() : false);

	function regText(status: string): { text: string; cls: string } | null {
		if (isPast) return null;
		if (status === 'open') return { text: '🟢 Registration open', cls: 'chip-green' };
		if (status === 'opening_soon') return { text: '⏰ Opens soon', cls: 'chip-yellow' };
		if (status === 'closed') return { text: '🔒 Closed', cls: 'chip-muted' };
		return null;
	}

	async function setStatus(status: string | null) {
		const prev = myStatus;
		myStatus = status;
		const res = await fetch(`/api/races/${data.race.id}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status, bibNumber: myBib || null })
		});
		if (!res.ok) myStatus = prev;
	}

	async function saveBib() {
		savingBib = true;
		myBib = bibInput.trim();
		await fetch(`/api/races/${data.race.id}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: myStatus ?? 'attending', bibNumber: myBib || null })
		});
		if (!myStatus || myStatus === 'interested') myStatus = 'attending';
		savingBib = false;
		editingBib = false;
		bibLookupDone = false;
		bibResults = [];
		// Immediately try to find the result for this bib
		if (myBib) await refreshMyResult();
	}

	async function clearBib() {
		myBib = '';
		bibInput = '';
		bibResults = [];
		editingBib = true;
		await fetch(`/api/races/${data.race.id}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: myStatus, bibNumber: null })
		});
	}

	async function refreshMyResult() {
		refreshingResult = true;
		try {
			const res = await fetch(`/api/races/${data.race.id}/results/lookup?bib=${encodeURIComponent(myBib)}`);
			if (res.ok) {
				const json = await res.json() as { results: typeof data.results; bibResults: typeof bibResults };
				results = json.results;
				bibResults = json.bibResults;
			}
		} finally {
			refreshingResult = false;
			startCooldown();
		}
	}

	function startCooldown() {
		refreshCooldown = 10;
		const interval = setInterval(() => {
			refreshCooldown--;
			if (refreshCooldown <= 0) clearInterval(interval);
		}, 1000);
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

	async function fetchResults() {
		fetchingResults = true;
		researchLog = ['Searching for race results…'];
		try {
			const res = await fetch(`/api/races/${data.race.id}/results`, { method: 'POST' });
			if (res.ok) {
				const result = await res.json();
				researchLog = result.log ?? ['Done!'];
				setTimeout(() => window.location.reload(), 1500);
			} else {
				researchLog = [...researchLog, `Error: ${res.status} ${res.statusText}`];
			}
		} catch (err) {
			researchLog = [...researchLog, `Error: ${err}`];
		} finally {
			fetchingResults = false;
		}
	}

	// ── Admin inline editor ───────────────────────────────────────────────────
	let showAdminEdit = $state(false);
	let adminSaving = $state(false);
	let adminSaveResult = $state('');
	let adminEdit = $state({
		name: data.race.name,
		city: data.race.city,
		distanceKm: data.race.distanceKm ?? null as number | null,
		category: data.race.category as 'local' | 'norway' | 'international',
		raceDate: data.race.raceDate ? data.race.raceDate.slice(0, 10) : '',
		registrationStatus: data.race.registrationStatus as string,
		medalStatus: data.race.medalStatus as string,
		websiteUrl: data.race.websiteUrl ?? '',
		registrationUrl: data.race.registrationUrl ?? '',
		resultsUrl: data.race.resultsUrl ?? '',
		imageUrl: data.race.imageUrl ?? '',
		whyItFits: data.race.whyItFits ?? ''
	});

	async function saveAdminEdit() {
		adminSaving = true;
		adminSaveResult = '';
		try {
			const res = await fetch(`/api/races/${data.race.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...adminEdit,
					distanceKm: adminEdit.distanceKm ? Number(adminEdit.distanceKm) : null,
					raceDate: adminEdit.raceDate || null
				})
			});
			if (res.ok) {
				adminSaveResult = '✓ Saved';
				setTimeout(() => window.location.reload(), 800);
			} else {
				const err = await res.json().catch(() => ({}));
				adminSaveResult = `✗ ${err.message ?? res.statusText}`;
			}
		} catch (err) {
			adminSaveResult = `✗ ${err}`;
		} finally {
			adminSaving = false;
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
	<div class="hero" style="background:{data.race.imageUrl ? `url(${data.race.imageUrl}) center/cover` : palette.bg};">
		{#if data.race.imageUrl}
			<div class="hero-overlay"></div>
		{/if}
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
				<div class="status-buttons">
					<button
						class="btn-status {myStatus === 'interested' ? 'active' : ''}"
						onclick={() => setStatus(myStatus === 'interested' ? null : 'interested')}
					>
						{myStatus === 'interested' ? '❤️' : '🤍'} Follow
					</button>
					<button
						class="btn-status btn-attending {myStatus === 'attending' ? 'active' : ''}"
						onclick={() => setStatus(myStatus === 'attending' ? null : 'attending')}
					>
						{myStatus === 'attending' ? '🏃' : '🎽'} Attending
					</button>
				</div>

				{#if myStatus === 'attending'}
					<div class="bib-section">
						{#if myBib && !editingBib}
							<div class="bib-display">
								<span class="bib-display-label">BIB</span>
								<span class="bib-display-number">#{myBib}</span>
								<button class="btn-bib-edit" onclick={() => { bibInput = myBib; editingBib = true; }} title="Edit BIB number">✎</button>
							</div>
						{:else}
							<label class="bib-label">My BIB number</label>
							<div class="bib-row">
								<input
									type="text"
									bind:value={bibInput}
									placeholder="e.g. 239"
									class="bib-input"
									maxlength="20"
								/>
								<button class="btn-bib" onclick={saveBib} disabled={savingBib || !bibInput.trim()}>
									{savingBib ? 'Saving…' : 'Save'}
								</button>
								{#if myBib}
									<button class="btn-bib-cancel" onclick={() => { bibInput = myBib; editingBib = false; }}>✕</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
			{#if data.race.registrationUrl && !isPast && myStatus !== 'attending' && !myBib}
				<a href={data.race.registrationUrl} target="_blank" rel="noopener noreferrer" class="btn-register">
					Register →
				</a>
			{/if}
		</div>

		<!-- My result (matched by BIB) -->
		{#if myBib && myStatus === 'attending'}
			<div class="my-result-card {bibResults.length > 0 ? 'has-result' : ''}">
				<div class="my-result-header">
					{bibResults.length > 0 ? '🎉 Your Results' : '⏳ Result not yet available'}
					<button
						class="btn-refresh-result"
						onclick={refreshMyResult}
						disabled={refreshingResult || refreshCooldown > 0}
					>
						{#if refreshingResult}
							Checking…
						{:else if refreshCooldown > 0}
							{refreshCooldown}s
						{:else}
							↻ Refresh
						{/if}
					</button>
				</div>
				{#if bibResults.length > 0}
					{#each bibResults as result}
						<div class="my-result-body">
							<div class="my-result-main">
								<span class="my-result-pos">
									{#if result.position === 1}🥇
									{:else if result.position === 2}🥈
									{:else if result.position === 3}🥉
									{:else}#{result.position}
									{/if}
								</span>
								<span class="my-result-time">{result.finishTime}</span>
								{#if result.category}
									<span class="my-result-cat">{result.category}</span>
								{/if}
							</div>
							<div class="my-result-distance">
								{#if result.distance}
									{result.distance}
								{:else if data.race.distanceKm}
									{data.race.distanceKm} km
								{/if}
							</div>
						</div>
					{/each}
				{:else}
					<p class="my-result-hint">BIB #{myBib} — results will appear here once published</p>
				{/if}
				<button class="btn-clear-bib" onclick={clearBib}>✕ Clear BIB</button>
			</div>
		{/if}
	</div>

	<!-- ═══ Other distances ═══ -->
	{#if data.siblings.length > 0}
		{@const allDistances = [
			{ id: data.race.id, distanceKm: data.race.distanceKm, active: true },
			...data.siblings.map(s => ({ id: s.id, distanceKm: s.distanceKm, active: false }))
		].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))}
		<div class="distances-card">
			<h3 class="distances-title">🏃 Also available at this event</h3>
			<div class="distances-row">
				{#each allDistances as d}
					<a href="/races/{d.id}" class="distance-pill {d.active ? 'active' : ''}">
						{bigDistance(d.distanceKm)}
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ═══ Leaderboard ═══ -->
	{#if results.length > 0}
		<div class="leaderboard-card">
			<h3 class="leaderboard-title">🏆 Results</h3>
			<div class="leaderboard-table">
				<div class="lb-header">
					<span class="lb-pos">#</span>
					<span class="lb-name">Runner</span>
					<span class="lb-time">Time</span>
				</div>
				{#each results as result, i}
					<div class="lb-row {i < 3 ? 'lb-podium' : ''} {myBib && result.bibNumber === myBib ? 'lb-me' : ''}">
						<span class="lb-pos">
							{#if i === 0}🥇
							{:else if i === 1}🥈
							{:else if i === 2}🥉
							{:else}{result.position ?? i + 1}
							{/if}
						</span>
						<span class="lb-name">
							{result.name}
							{#if result.club}
								<span class="lb-club">{result.club}</span>
							{/if}
						</span>
						<span class="lb-time">{result.finishTime}</span>
					</div>
				{/each}
			</div>
			{#if data.race.resultsUrl}
				<a href={data.race.resultsUrl} target="_blank" rel="noopener noreferrer" class="lb-full-link">
					View full results →
				</a>
			{/if}
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
				<button class="btn-research" onclick={fetchResults} disabled={fetchingResults}>
					{fetchingResults ? '📊 Fetching…' : '📊 Fetch results'}
				</button>
				<button class="btn-admin-edit {showAdminEdit ? 'active' : ''}" onclick={() => showAdminEdit = !showAdminEdit}>
					✏️ Edit fields
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

			{#if showAdminEdit}
				<div class="admin-edit-panel">
					<!-- Read-only info -->
					<div class="admin-info-row">
						<span class="admin-info-label">Source</span>
						<a href={data.race.sourceUrl ?? '#'} target="_blank" rel="noopener noreferrer" class="admin-info-link">{data.race.sourceUrl ?? '—'}</a>
					</div>
					<div class="admin-info-row">
						<span class="admin-info-label">Fingerprint</span>
						<span class="admin-info-value">{data.race.fingerprint}</span>
					</div>
					<div class="admin-info-row">
						<span class="admin-info-label">First seen</span>
						<span class="admin-info-value">{new Date(data.race.firstSeenAt).toLocaleString('en-GB')}</span>
					</div>
					<div class="admin-info-row">
						<span class="admin-info-label">Last updated</span>
						<span class="admin-info-value">{new Date(data.race.lastUpdatedAt).toLocaleString('en-GB')}</span>
					</div>

					<hr class="admin-divider" />

					<!-- Editable fields -->
					<div class="admin-field-grid">
						<label class="admin-field">
							<span class="admin-field-label">Name</span>
							<input class="admin-input" bind:value={adminEdit.name} />
						</label>
						<label class="admin-field">
							<span class="admin-field-label">City</span>
							<input class="admin-input" bind:value={adminEdit.city} />
						</label>
						<label class="admin-field">
							<span class="admin-field-label">Distance (km)</span>
							<input class="admin-input" type="number" step="0.1" bind:value={adminEdit.distanceKm} />
						</label>
						<label class="admin-field">
							<span class="admin-field-label">Race date</span>
							<input class="admin-input" type="date" bind:value={adminEdit.raceDate} />
						</label>
						<label class="admin-field">
							<span class="admin-field-label">Category</span>
							<select class="admin-input" bind:value={adminEdit.category}>
								<option value="local">local</option>
								<option value="norway">norway</option>
								<option value="international">international</option>
							</select>
						</label>
						<label class="admin-field">
							<span class="admin-field-label">Registration status</span>
							<select class="admin-input" bind:value={adminEdit.registrationStatus}>
								<option value="open">open</option>
								<option value="opening_soon">opening_soon</option>
								<option value="closed">closed</option>
								<option value="unknown">unknown</option>
							</select>
						</label>
						<label class="admin-field">
							<span class="admin-field-label">Medal status</span>
							<select class="admin-input" bind:value={adminEdit.medalStatus}>
								<option value="confirmed">confirmed</option>
								<option value="likely">likely</option>
								<option value="unclear">unclear</option>
							</select>
						</label>
						<label class="admin-field admin-field-full">
							<span class="admin-field-label">Why it fits</span>
							<textarea class="admin-input" rows="2" bind:value={adminEdit.whyItFits}></textarea>
						</label>
						<label class="admin-field admin-field-full">
							<span class="admin-field-label">Website URL</span>
							<input class="admin-input" type="url" bind:value={adminEdit.websiteUrl} />
						</label>
						<label class="admin-field admin-field-full">
							<span class="admin-field-label">Registration URL</span>
							<input class="admin-input" type="url" bind:value={adminEdit.registrationUrl} />
						</label>
						<label class="admin-field admin-field-full">
							<span class="admin-field-label">Results URL</span>
							<input class="admin-input" type="url" bind:value={adminEdit.resultsUrl} placeholder="e.g. https://live.ultimate.dk/…" />
						</label>
						<label class="admin-field admin-field-full">
							<span class="admin-field-label">Image URL</span>
							<input class="admin-input" type="url" bind:value={adminEdit.imageUrl} />
						</label>
					</div>

					<div class="admin-save-row">
						{#if adminSaveResult}
							<span class="admin-save-result {adminSaveResult.startsWith('✓') ? 'ok' : 'err'}">{adminSaveResult}</span>
						{/if}
						<button class="btn-admin-save" onclick={saveAdminEdit} disabled={adminSaving}>
							{adminSaving ? 'Saving…' : 'Save changes'}
						</button>
					</div>
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

	<!-- Source (informational, at the very bottom) -->
	{#if data.race.sourceUrl}
		<div class="source-card">
			<span class="source-label">Source:</span>
			<a href={data.race.sourceUrl} target="_blank" rel="noopener noreferrer" class="source-link">
				{data.race.sourceUrl}
			</a>
			<span class="source-date">Found {new Date(data.race.firstSeenAt).toLocaleDateString('en-GB')}</span>
		</div>
	{/if}
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
	.hero-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.65) 100%);
		z-index: 1;
	}
	.hero-route {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0.8;
		z-index: 2;
	}
	.hero-content {
		position: relative;
		z-index: 3;
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
		z-index: 3;
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
		flex-direction: column;
		gap: 12px;
		margin-top: 16px;
	}
	.status-buttons {
		display: flex;
		gap: 10px;
	}
	.btn-status {
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
	.btn-status:hover { background: rgba(255,255,255,0.12); }
	.btn-status.active {
		background: rgba(244,63,94,0.14);
		border-color: rgba(244,63,94,0.4);
		color: #fb7185;
	}
	.btn-status.btn-attending.active {
		background: rgba(163,230,53,0.14);
		border-color: rgba(163,230,53,0.4);
		color: #a3e635;
	}
	.bib-section {
		background: rgba(255,255,255,0.04);
		border-radius: 12px;
		padding: 12px 14px;
	}
	.bib-label {
		display: block;
		font-size: 0.8rem;
		color: rgba(255,255,255,0.5);
		margin-bottom: 6px;
		font-weight: 600;
	}
	.bib-row {
		display: flex;
		gap: 8px;
	}
	.bib-input {
		flex: 1;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(255,255,255,0.07);
		border: 1px solid rgba(255,255,255,0.12);
		color: white;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 1px;
	}
	.bib-input::placeholder { color: rgba(255,255,255,0.3); }
	.btn-bib {
		padding: 10px 16px;
		border-radius: 10px;
		background: #a3e635;
		color: #0c0f1a;
		font-weight: 800;
		font-size: 0.85rem;
		border: none;
		cursor: pointer;
	}
	.btn-bib:disabled { opacity: 0.4; cursor: default; }
	.btn-bib-cancel {
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(255,255,255,0.06);
		color: rgba(255,255,255,0.4);
		font-size: 0.9rem;
		border: 1px solid rgba(255,255,255,0.1);
		cursor: pointer;
	}
	.btn-bib-cancel:hover { color: white; background: rgba(255,255,255,0.1); }
	.bib-display {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.bib-display-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255,255,255,0.35);
	}
	.bib-display-number {
		font-size: 1.4rem;
		font-weight: 900;
		color: #a3e635;
		letter-spacing: 1px;
		font-variant-numeric: tabular-nums;
	}
	.btn-bib-edit {
		margin-left: auto;
		padding: 4px 8px;
		border-radius: 7px;
		background: transparent;
		color: rgba(255,255,255,0.3);
		font-size: 0.9rem;
		border: 1px solid rgba(255,255,255,0.1);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-bib-edit:hover { color: white; background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
	.my-result-card {
		margin-top: 16px;
		background: rgba(255,255,255,0.04);
		border: 1.5px solid rgba(255,255,255,0.1);
		border-radius: 14px;
		padding: 16px;
	}
	.my-result-card.has-result {
		background: linear-gradient(135deg, rgba(163,230,53,0.12), rgba(163,230,53,0.04));
		border-color: rgba(163,230,53,0.3);
	}
	.my-result-header {
		font-size: 0.85rem;
		font-weight: 800;
		color: rgba(255,255,255,0.5);
		margin-bottom: 8px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.my-result-card.has-result .my-result-header {
		color: #a3e635;
	}
	.btn-refresh-result {
		font-size: 0.8rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 8px;
		border: 1px solid rgba(255,255,255,0.15);
		background: rgba(255,255,255,0.06);
		color: rgba(255,255,255,0.6);
		cursor: pointer;
		transition: all 0.15s;
		font-variant-numeric: tabular-nums;
		min-width: 72px;
		text-align: center;
	}
	.btn-refresh-result:hover:not(:disabled) {
		background: rgba(255,255,255,0.12);
		color: white;
	}
	.btn-refresh-result:disabled { opacity: 0.45; cursor: default; }
	.my-result-hint {
		font-size: 0.85rem;
		color: rgba(255,255,255,0.4);
		margin: 0;
	}
	.my-result-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.my-result-main {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.my-result-distance {
		font-size: 0.8rem;
		color: rgba(255,255,255,0.5);
		font-weight: 600;
	}
	.my-result-pos {
		font-size: 1.5rem;
		font-weight: 900;
		color: white;
	}
	.my-result-time {
		font-size: 1.3rem;
		font-weight: 800;
		color: white;
		font-variant-numeric: tabular-nums;
	}
	.my-result-cat {
		font-size: 0.8rem;
		background: rgba(255,255,255,0.08);
		padding: 4px 8px;
		border-radius: 6px;
		color: rgba(255,255,255,0.6);
	}
	.my-result-body + .my-result-body {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(255,255,255,0.06);
	}
	.btn-clear-bib {
		margin-top: 10px;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid rgba(255,255,255,0.1);
		background: transparent;
		color: rgba(255,255,255,0.4);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-clear-bib:hover {
		color: #f87171;
		border-color: #f87171;
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
		text-align: center;
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

	/* ── Distances card ── */
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
		font-weight: 800;
		color: #94a3b8;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.1);
		text-decoration: none;
		transition: all 0.15s;
	}
	.distance-pill:hover {
		color: white;
		background: rgba(255,255,255,0.1);
	}
	.distance-pill.active {
		color: #0c0f1a;
		background: #a3e635;
		border-color: #a3e635;
	}

	/* ── Leaderboard ── */
	.leaderboard-card {
		background: #151a2e;
		border-radius: 1rem;
		padding: 16px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.leaderboard-title {
		font-size: 1rem;
		font-weight: 800;
		color: white;
		margin-bottom: 14px;
	}
	.leaderboard-table {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.lb-header {
		display: grid;
		grid-template-columns: 40px 1fr 80px;
		padding: 8px 12px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
		border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.lb-row {
		display: grid;
		grid-template-columns: 40px 1fr 80px;
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 0.85rem;
		align-items: center;
		transition: background 0.1s;
	}
	.lb-row:hover {
		background: rgba(255,255,255,0.03);
	}
	.lb-podium {
		background: rgba(245,158,11,0.04);
	}
	.lb-podium:hover {
		background: rgba(245,158,11,0.08);
	}
	.lb-me {
		background: rgba(163,230,53,0.1) !important;
		border-left: 3px solid #a3e635;
	}
	.lb-pos {
		font-weight: 800;
		color: #94a3b8;
		font-size: 0.9rem;
	}
	.lb-name {
		color: white;
		font-weight: 600;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.lb-club {
		font-size: 0.72rem;
		color: #64748b;
		font-weight: 400;
	}
	.lb-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.82rem;
		font-weight: 700;
		color: #a3e635;
		text-align: right;
	}
	.lb-full-link {
		display: block;
		margin-top: 14px;
		text-align: center;
		font-size: 0.82rem;
		font-weight: 700;
		color: #a3e635;
		text-decoration: none;
	}
	.lb-full-link:hover {
		text-decoration: underline;
	}

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
	.btn-admin-edit {
		padding: 10px 18px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 700;
		border: 1px solid rgba(139, 92, 246, 0.3);
		cursor: pointer;
		background: transparent;
		color: #a78bfa;
		transition: all 0.15s;
	}
	.btn-admin-edit:hover, .btn-admin-edit.active {
		background: rgba(139, 92, 246, 0.2);
	}
	.admin-edit-panel {
		margin-top: 14px;
		background: rgba(0,0,0,0.25);
		border-radius: 12px;
		padding: 14px;
		border: 1px solid rgba(139, 92, 246, 0.15);
	}
	.admin-info-row {
		display: flex;
		gap: 10px;
		align-items: baseline;
		margin-bottom: 6px;
	}
	.admin-info-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #7c3aed;
		min-width: 80px;
		flex-shrink: 0;
	}
	.admin-info-value {
		font-size: 0.78rem;
		color: #94a3b8;
		font-family: monospace;
		word-break: break-all;
	}
	.admin-info-link {
		font-size: 0.78rem;
		color: #a78bfa;
		word-break: break-all;
		text-decoration: none;
	}
	.admin-info-link:hover { text-decoration: underline; }
	.admin-divider {
		border: none;
		border-top: 1px solid rgba(139, 92, 246, 0.15);
		margin: 12px 0;
	}
	.admin-field-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.admin-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.admin-field-full {
		grid-column: 1 / -1;
	}
	.admin-field-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #7c3aed;
	}
	.admin-input {
		padding: 7px 10px;
		border-radius: 8px;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(139, 92, 246, 0.2);
		color: #e2e8f0;
		font-size: 0.83rem;
		width: 100%;
		box-sizing: border-box;
	}
	.admin-input:focus {
		outline: none;
		border-color: rgba(139, 92, 246, 0.5);
	}
	select.admin-input option { background: #1e1b4b; }
	textarea.admin-input { resize: vertical; font-family: inherit; }
	.admin-save-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 12px;
	}
	.admin-save-result {
		font-size: 0.82rem;
		font-weight: 600;
	}
	.admin-save-result.ok { color: #86efac; }
	.admin-save-result.err { color: #fca5a5; }
	.btn-admin-save {
		padding: 9px 20px;
		border-radius: 10px;
		background: #7c3aed;
		color: white;
		font-size: 0.85rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-admin-save:hover:not(:disabled) { background: #6d28d9; }
	.btn-admin-save:disabled { opacity: 0.5; cursor: default; }
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
