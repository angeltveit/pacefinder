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
	let fixInstruction = $state('');
	let fixing = $state(false);
	let bibResults = $state<{ position: number | null; name: string; bibNumber: string | null; finishTime: string; category: string | null; categoryPosition: number | null; club: string | null; distance: string | null }[]>(
		data.myResult ? [data.myResult] : []
	);

	// Re-sync local state when navigating between distances (same component, new data)
	let prevRaceId = $state(data.race.id);
	let prevResultsUrl = $state(data.race.resultsUrl);
	$effect(() => {
		if (data.race.id !== prevRaceId) {
			const sameResultsUrl = data.race.resultsUrl === prevResultsUrl;
			prevRaceId = data.race.id;
			prevResultsUrl = data.race.resultsUrl;
			comments = data.comments;
			results = data.results;
			myStatus = data.myStatus;
			myBib = data.myBib ?? '';
			bibInput = data.myBib ?? '';
			editingBib = !data.myBib;
			if (!sameResultsUrl) {
				bibResults = data.myResult ? [data.myResult] : [];
				bibLookupDone = false;
			}
		}
	});

	let bibLookupDone = $state(false);
	let autoSearching = $state(false);
	let autoSearchDone = $state(false); // true after first auto-search attempt completes

	// ── Search any bib in the race ────────────────────────────────────────
	let searchBib = $state('');
	let searchingBib = $state(false);
	let searchDone = $state(false);
	let searchResults = $state<typeof bibResults>([]);

	async function searchByBib() {
		const q = searchBib.trim();
		if (!q) return;
		searchingBib = true;
		searchDone = false;
		try {
			const res = await fetch(
				`/api/races/${data.race.id}/results/lookup?q=${encodeURIComponent(q)}`
			);
			if (res.ok) {
				const json = (await res.json()) as {
					results: typeof data.results;
					bibResults: typeof bibResults;
				};
				results = json.results;
				searchResults = json.bibResults;
			} else {
				searchResults = [];
			}
		} catch {
			searchResults = [];
		} finally {
			searchingBib = false;
			searchDone = true;
		}
	}

	// ── Category theming ──────────────────────────────────────────────────
	import Icon from '$lib/components/Icon.svelte';
	import TopoArt from '$lib/components/TopoArt.svelte';
	import { categoryTheme, proxyImage, raceNarrative, raceHighlights, avatar, shortDate, distanceLabel } from '$lib/theme';

	let heroImgOk = $state(true);
	const theme = $derived(categoryTheme(data.race.category));
	const heroImg = $derived(proxyImage(data.race.imageUrl));

	function bigDistance(km: number | null): string {
		if (!km) return '?K';
		if (km >= 42 && km <= 43) return '42.2K';
		if (km >= 21 && km <= 22) return '21.1K';
		if (km === Math.round(km)) return `${Math.round(km)}K`;
		return `${km}K`;
	}

	function categoryLabel(cat: string, km: number | null): string {
		const d = km ?? 0;
		if (cat === 'local' && d >= 42) return 'Local marathon';
		if (cat === 'local' && d >= 21) return 'Local half';
		if (cat === 'local') return 'Local race';
		if (cat === 'norway' && d >= 42) return 'Epic Norway';
		if (cat === 'norway') return 'Weekend trip';
		return 'Bucket list';
	}

	function formatDate(d: string | null): string {
		if (!d) return 'TBA';
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function medalText(status: string): string | null {
		if (status === 'confirmed') return 'Medal confirmed';
		if (status === 'likely') return 'Medal likely';
		return null;
	}

	const isPast = $derived(data.race.raceDate ? new Date(data.race.raceDate) < new Date() : false);

	function regText(status: string): { text: string; cls: string } | null {
		if (isPast) return null;
		if (status === 'open') return { text: 'Registration open', cls: 'chip-green' };
		if (status === 'opening_soon') return { text: 'Opens soon', cls: 'chip-yellow' };
		if (status === 'closed') return { text: 'Closed', cls: 'chip-muted' };
		return null;
	}

	async function setStatus(status: string | null) {
		const prev = myStatus;
		myStatus = status;

		// Fire name-search immediately in parallel with status save so the
		// "Searching…" indicator appears right away without waiting for the API.
		const searchPromise = (status === 'attending' && !myBib && data.user?.name)
			? autoSearchBibByName()
			: null;

		const res = await fetch(`/api/races/${data.race.id}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status, bibNumber: myBib || null })
		});
		if (!res.ok) { myStatus = prev; return; }

		await searchPromise;
	}

	async function autoSearchBibByName() {
		const name = data.user?.name;
		if (!name) return;
		autoSearching = true;
		autoSearchDone = false;
		bibResults = [];
		try {
			const res = await fetch(`/api/races/${data.race.id}/results/lookup?q=${encodeURIComponent(name)}`);
			if (res.ok) {
				const json = await res.json() as { results: typeof data.results; bibResults: typeof bibResults };
				results = json.results;
				bibResults = json.bibResults;
				// Pre-fill bib input if exactly one match found
				if (json.bibResults.length === 1 && json.bibResults[0].bibNumber) {
					bibInput = json.bibResults[0].bibNumber;
				}
			}
		} finally {
			autoSearching = false;
			autoSearchDone = true;
		}
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
				comments = [...comments, { ...comment, authorName: data.user?.name ?? 'You', authorId: data.user?.id, createdAt: new Date().toISOString(), reactions: {}, myReactions: [] }];
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

	// ── Gamified reactions ────────────────────────────────────────────────
	const REACTIONS: { key: string; char: string; label: string }[] = [
		{ key: 'fire', char: '🔥', label: 'Fire' },
		{ key: 'muscle', char: '💪', label: 'Beast' },
		{ key: 'tada', char: '🎉', label: 'Hype' },
		{ key: 'heart', char: '❤️', label: 'Love' },
		{ key: 'sweat', char: '😅', label: 'Relatable' },
		{ key: 'goat', char: '🐐', label: 'GOAT' }
	];
	let reactionPickerFor = $state<string | null>(null);

	async function toggleReaction(commentId: string, emoji: string) {
		if (!data.user) {
			window.location.href = '/login';
			return;
		}
		reactionPickerFor = null;
		// Optimistic update
		const idx = comments.findIndex((c) => c.id === commentId);
		if (idx === -1) return;
		const c = comments[idx];
		const mine = c.myReactions ?? [];
		const has = mine.includes(emoji);
		const nextCounts = { ...(c.reactions ?? {}) };
		nextCounts[emoji] = Math.max(0, (nextCounts[emoji] ?? 0) + (has ? -1 : 1));
		if (nextCounts[emoji] === 0) delete nextCounts[emoji];
		const nextMine = has ? mine.filter((e) => e !== emoji) : [...mine, emoji];
		comments[idx] = { ...c, reactions: nextCounts, myReactions: nextMine };
		comments = [...comments];
		try {
			const res = await fetch(`/api/comments/${commentId}/react`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji })
			});
			if (res.ok) {
				const { counts } = await res.json();
				const j = comments.findIndex((cc) => cc.id === commentId);
				if (j !== -1) {
					comments[j] = { ...comments[j], reactions: counts };
					comments = [...comments];
				}
			}
		} catch {
			// keep optimistic state on network hiccup
		}
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

	async function fixWithAi() {
		const instruction = fixInstruction.trim();
		if (!instruction) return;
		fixing = true;
		researchLog = [`🤖 Applying: "${instruction}"`];
		try {
			const res = await fetch(`/api/races/${data.race.id}/fix`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instruction })
			});
			const result = await res.json().catch(() => ({}));
			if (res.ok) {
				researchLog = result.log ?? ['Done!'];
				if ((result.changed ?? []).length > 0) {
					fixInstruction = '';
					setTimeout(() => window.location.reload(), 1500);
				}
			} else {
				researchLog = [...researchLog, `Error: ${result.message ?? res.statusText}`];
			}
		} catch (err) {
			researchLog = [...researchLog, `Error: ${err}`];
		} finally {
			fixing = false;
		}
	}
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
	const dateChip = $derived(shortDate(data.race.raceDate));
	const closingSoon = $derived(
		data.race.registrationStatus === 'open' && !isPast && deadlineDays != null && deadlineDays <= 30
	);
	const allKm = $derived(
		[...new Set([data.race.distanceKm, ...data.siblings.map(s => s.distanceKm)])]
			.filter(Boolean)
			.sort((a, b) => (a ?? 0) - (b ?? 0))
	);

	// ── Key facts ─────────────────────────────────────────────────────────
	function fmtPrice(min: number | null, max: number | null, cur: string | null): string | null {
		if (min == null && max == null) return null;
		const c = cur ?? 'NOK';
		if (min != null && max != null && min !== max) return `${min}–${max} ${c}`;
		return `${min ?? max} ${c}`;
	}
	const deadlineDays = $derived.by(() => {
		if (!data.race.registrationDeadline) return null;
		const ms = new Date(data.race.registrationDeadline).getTime() - Date.now();
		return Math.ceil(ms / 86_400_000);
	});
	const facts = $derived.by(() => {
		const r = data.race;
		const list: { icon: string; label: string; value: string; urgent?: boolean }[] = [];
		const price = fmtPrice(r.priceMin, r.priceMax, r.priceCurrency);
		if (price) list.push({ icon: 'zap', label: 'Entry', value: price });
		if (deadlineDays != null && deadlineDays >= 0 && !isPast) {
			list.push({
				icon: 'clock',
				label: 'Closes',
				value: deadlineDays === 0 ? 'Today' : `in ${deadlineDays} day${deadlineDays === 1 ? '' : 's'}`,
				urgent: deadlineDays <= 14
			});
		}
		if (r.elevationGainM) list.push({ icon: 'mountain', label: 'Climb', value: `${Math.round(r.elevationGainM)} m` });
		if (r.surface) list.push({ icon: 'route', label: 'Surface', value: r.surface });
		if (r.fieldSize) list.push({ icon: 'users', label: 'Field', value: `${r.fieldSize.toLocaleString('en')} runners` });
		return list;
	});

	// ── Rich narrative ────────────────────────────────────────────────────
	const narrative = $derived(
		raceNarrative({
			eventName: data.race.eventName,
			city: data.race.city,
			country: data.race.country,
			category: data.race.category,
			distanceKm: data.race.distanceKm,
			medalStatus: data.race.medalStatus,
			surface: data.race.surface,
			elevationGainM: data.race.elevationGainM,
			fieldSize: data.race.fieldSize,
			raceDate: data.race.raceDate,
			priceMin: data.race.priceMin,
			priceMax: data.race.priceMax,
			priceCurrency: data.race.priceCurrency,
			whyItFits: data.race.whyItFits
		})
	);
	const highlights = $derived(
		raceHighlights({
			eventName: data.race.eventName,
			city: data.race.city,
			country: data.race.country,
			category: data.race.category,
			distanceKm: data.race.distanceKm,
			medalStatus: data.race.medalStatus,
			surface: data.race.surface,
			elevationGainM: data.race.elevationGainM,
			fieldSize: data.race.fieldSize,
			raceDate: data.race.raceDate
		})
	);

	// ── Race-day essentials: the things runners always wonder about ────────
	type Essential = { icon: string; label: string; value: string | null };
	const essentials = $derived.by<Essential[]>(() => {
		const r = data.race;
		const rdi = r.raceDayInfo;
		const medalValue =
			r.medalStatus === 'confirmed'
				? 'Yes — finisher medal'
				: r.medalStatus === 'likely'
					? 'Most likely'
					: null;
		const medalDisplay = rdi?.medalNote ?? medalValue;
		return [
			{ icon: 'map-pin', label: 'Where', value: rdi?.address ?? r.location ?? null },
			{ icon: 'medal', label: 'Medal', value: medalDisplay },
			{ icon: 'clock', label: 'Start time', value: rdi?.startTimes ?? null },
			{ icon: 'ticket', label: 'Bib pickup', value: rdi?.bibPickup ?? null },
			{ icon: 'package', label: 'Toilets & bag drop', value: rdi?.facilities ?? null },
			{ icon: 'utensils', label: 'Food & extras', value: rdi?.extras ?? null }
		];
	});
	const knownEssentials = $derived(essentials.filter((e) => e.value));
	const missingEssentials = $derived(essentials.filter((e) => !e.value));
</script>

<svelte:head><title>{data.race.eventName} — PaceFinder</title></svelte:head>

<div class="detail-page" style="--accent:{theme.color}; --soft:{theme.soft};">
	<!-- Back link -->
	<a href="/races" class="back-link"><Icon name="chevron-right" size={15} class="back-ic" /> Back to races</a>

	<!-- ═══ Hero header ═══ -->
	<div class="hero pf-rise">
		{#if data.race.imageUrl && heroImgOk}
			<img class="hero-img" src={heroImg} alt={data.race.eventName} onerror={() => heroImgOk = false} />
			<div class="hero-overlay"></div>
		{:else}
			<TopoArt seed={data.race.id} color={theme.color} class="hero-topo" />
			<div class="hero-overlay hero-overlay-soft"></div>
		{/if}

		<div class="hero-top">
			<div class="hero-cat"><Icon name={theme.icon as never} size={14} /> {catLabel}</div>
			{#if dateChip}
				<div class="hero-date">
					<strong>{dateChip.day}</strong>
					<small>{dateChip.month}</small>
				</div>
			{/if}
		</div>

		<div class="hero-bottom">
			{#if data.race.medalStatus === 'confirmed' || data.race.medalStatus === 'likely'}
				<span class="hero-tag hero-tag-medal"><Icon name="medal" size={13} /> {data.race.medalStatus === 'confirmed' ? 'Medal' : 'Medal likely'}</span>
			{/if}
			{#if closingSoon && deadlineDays != null}
				<span class="hero-tag hero-tag-urgent"><Icon name="flame" size={13} /> Closes in {deadlineDays}d</span>
			{:else if data.race.registrationStatus === 'open'}
				<span class="hero-tag hero-tag-open"><span class="dot"></span> Open</span>
			{/if}
		</div>
	</div>

	<!-- ═══ Main content ═══ -->
	<div class="content-card">
		<h1 class="title">{data.race.eventName}</h1>
		<p class="meta">
			<Icon name="map-pin" size={15} /> {data.race.city}{data.race.country !== 'NO' ? `, ${data.race.country}` : ''}
			{#if data.race.location && data.race.location !== data.race.city}
				· {data.race.location}
			{/if}
			<span class="sep">·</span>
			<Icon name="calendar" size={15} /> {formatDate(data.race.raceDate)}
		</p>

		<!-- Distance chips -->
		{#if allKm.length > 0}
			<div class="dist-row">
				{#each allKm as km}
					<span class="dist">{distanceLabel(km)}</span>
				{/each}
			</div>
		{/if}

		<!-- Key facts -->
		{#if facts.length > 0}
			<div class="facts">
				{#each facts as f}
					<div class="fact {f.urgent ? 'fact-urgent' : ''}">
						<span class="fact-ic"><Icon name={f.icon as never} size={16} /></span>
						<div class="fact-text">
							<span class="fact-label">{f.label}</span>
							<span class="fact-value">{f.value}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Verdict -->
		{#if data.race.whyItFits}
			<p class="verdict">"{data.race.whyItFits}"</p>
		{/if}

		<!-- Actions -->
		<div class="actions">
			{#if data.user}
				<div class="status-buttons">
					<button
						class="btn-status {myStatus === 'interested' ? 'active' : ''}"
						onclick={() => setStatus(myStatus === 'interested' ? null : 'interested')}
					>
						<Icon name="heart" size={16} fill={myStatus === 'interested'} /> {myStatus === 'interested' ? 'Following' : 'Follow'}
						{#if data.interestedCount > 0}<span class="btn-count">{data.interestedCount}</span>{/if}
					</button>
					<button
						class="btn-status btn-attending {myStatus === 'attending' ? 'active' : ''}"
						onclick={() => setStatus(myStatus === 'attending' ? null : 'attending')}
					>
						<Icon name="ticket" size={16} /> {myStatus === 'attending' ? 'Attending' : 'I\'m going'}
					</button>
				</div>

				{#if myStatus === 'attending'}
					<div class="bib-section">
						{#if autoSearching}
							<div class="bib-searching">
								<Icon name="search" size={14} /> Searching for your results…
							</div>
						{:else if myBib && !editingBib}
							<div class="bib-display">
								<span class="bib-display-label">BIB</span>
								<span class="bib-display-number">#{myBib}</span>
								<button class="btn-bib-edit" onclick={() => { bibInput = myBib; editingBib = true; }} title="Edit BIB number">✎</button>
							</div>
						{:else}
							{#if bibResults.length > 0 && !myBib}
								<div class="bib-autofound">
									<Icon name="sparkles" size={13} /> Found: <strong>{bibResults[0].name}</strong> · BIB #{bibResults[0].bibNumber ?? '?'}
								</div>
							{:else if autoSearchDone && bibResults.length === 0}
								<p class="bib-no-result">No results found yet — enter your BIB manually once they're published.</p>
							{:else}
								<label class="bib-label">My BIB number</label>
							{/if}
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
		{#if myBib}
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
								<span class="my-result-time">{result.finishTime || '—'}</span>
								{#if result.category}
									<span class="my-result-cat">{result.category}</span>
								{/if}
							</div>
							<div class="my-result-meta">
								<span class="my-result-name">{result.name}</span>
								{#if result.bibNumber || myBib}
									<span class="my-result-bib">BIB #{result.bibNumber ?? myBib}</span>
								{/if}
								<span class="my-result-dist">
									{#if result.distance}
										{result.distance}
									{:else if data.race.distanceKm}
										{data.race.distanceKm} km
									{/if}
								</span>
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

	<!-- ═══ About this race ═══ -->
	{#if narrative.length > 0}
		<div class="about-card">
			<h2 class="section-title">
				<Icon name="sparkles" size={18} /> About this race
			</h2>
			{#if highlights.length > 0}
				<div class="highlight-strip">
					{#each highlights as h}
						<span class="highlight-chip"><Icon name={h.icon as never} size={14} /> {h.text}</span>
					{/each}
				</div>
			{/if}
			<div class="about-body">
				{#each narrative as para}
					<p class="about-para">{para}</p>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ═══ Race-day essentials ═══ -->
	<div class="essentials-card">
		<h2 class="section-title">
			<Icon name="info" size={18} /> Race-day essentials
		</h2>
		{#if knownEssentials.length > 0}
			<ul class="essentials-list">
				{#each knownEssentials as e}
					<li class="essential-row">
						<span class="essential-ic"><Icon name={e.icon as never} size={16} /></span>
						<span class="essential-text">
							<span class="essential-label">{e.label}</span>
							<span class="essential-value">{e.value}</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if missingEssentials.length > 0}
			<div class="essentials-missing">
				<p class="missing-lead">
					We haven't confirmed {missingEssentials.map((e) => e.label.toLowerCase()).join(', ')} yet.
				</p>
				<p class="missing-hint">
					{#if data.race.websiteUrl}
						Check the <a href={data.race.websiteUrl} target="_blank" rel="noopener noreferrer">official website</a> or the organiser's social media for the latest.
					{:else}
						Check the organiser's website or social media for the latest.
					{/if}
				</p>
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

	<!-- ═══ Find a runner by BIB ═══ -->
	{#if data.user && (results.length > 0 || (data.race.resultsUrl && isPast))}
		<div class="bib-search-card">
			<h3 class="bib-search-title">🔍 Find a runner</h3>
			<p class="bib-search-sub">Search by BIB number or runner name to see their result.</p>
			<div class="bib-search-row">
				<input
					type="text"
					class="bib-search-input"
					placeholder="BIB number or name"
					bind:value={searchBib}
					onkeydown={(e) => e.key === 'Enter' && !searchingBib && searchByBib()}
					disabled={searchingBib}
				/>
				<button
					class="btn-bib-search"
					onclick={searchByBib}
					disabled={searchingBib || !searchBib.trim()}
				>
					{searchingBib ? 'Searching…' : 'Search'}
				</button>
			</div>

			{#if searchResults.length > 0}
				{#each searchResults as result}
					<div class="bib-search-result">
						<span class="bib-result-pos">
							{#if result.position === 1}🥇
							{:else if result.position === 2}🥈
							{:else if result.position === 3}🥉
							{:else if result.position}#{result.position}
							{:else}—
							{/if}
						</span>
						<span class="bib-result-info">
							<span class="bib-result-name">
								{result.name}
								{#if result.bibNumber}<span class="bib-result-num">BIB #{result.bibNumber}</span>{/if}
							</span>
							{#if result.club}<span class="bib-result-club">{result.club}</span>{/if}
							<span class="bib-result-meta">
								{#if result.category}{result.category}{/if}
								{#if result.distance}· {result.distance}{:else if data.race.distanceKm}· {data.race.distanceKm} km{/if}
							</span>
						</span>
						<span class="bib-result-time">{result.finishTime}</span>
					</div>
				{/each}
			{:else if searchDone}
				<p class="bib-search-empty">
					{#if !isPast}
						Results aren't published yet — check back after the race.
					{:else}
						No runner found matching "{searchBib.trim()}".
					{/if}
				</p>
			{/if}
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

			<!-- Fix with AI: plain-language correction -->
			<div class="ai-fix">
				<label class="ai-fix-label" for="ai-fix-input">🤖 Fix with AI</label>
				<p class="ai-fix-hint">Describe what's wrong and the agent will correct the data — e.g. "this event only has medals for children", "the date is actually 5 May 2026", or "registration is closed now".</p>
				<textarea
					id="ai-fix-input"
					class="ai-fix-input"
					rows="2"
					placeholder="Tell the agent what needs to change…"
					bind:value={fixInstruction}
					disabled={fixing}
				></textarea>
				<button
					class="btn-ai-fix"
					onclick={fixWithAi}
					disabled={fixing || !fixInstruction.trim()}
				>
					{fixing ? '🤖 Applying…' : '✨ Apply fix'}
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
			<Icon name="message" size={18} /> The chatter
			{#if comments.length > 0}
				<span class="comment-count">{comments.length} {comments.length === 1 ? 'runner' : 'runners'} in the chat</span>
			{/if}
		</h2>

		{#if comments.length === 0}
			<div class="comments-empty">
				<span class="comments-empty-emoji">💬</span>
				<p class="comments-empty-title">No chatter yet</p>
				<p class="comments-empty-sub">
					{data.user ? 'Be the first to break the ice — drop a tip, a goal, or some hype.' : 'Log in and be the first to break the ice.'}
				</p>
			</div>
		{/if}

		{#each comments as comment (comment.id)}
			{@const av = avatar(comment.authorName)}
			<div class="comment-card">
				<div class="comment-header">
					<div class="comment-avatar" style="background:linear-gradient(135deg, {av.from}, {av.to});">{av.initials}</div>
					<span class="comment-author">{comment.authorName}</span>
					<span class="comment-date">
						{new Date(comment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
					</span>
					{#if data.user?.role === 'admin'}
						<button class="comment-delete" onclick={() => deleteComment(comment.id)}>Delete</button>
					{/if}
				</div>
				<p class="comment-body">{comment.body}</p>

				<!-- Reactions -->
				<div class="reaction-row">
					{#each REACTIONS as r}
						{@const count = comment.reactions?.[r.key] ?? 0}
						{#if count > 0}
							<button
								class="reaction-chip {comment.myReactions?.includes(r.key) ? 'mine' : ''}"
								onclick={() => toggleReaction(comment.id, r.key)}
								title={r.label}
							>
								<span class="reaction-emoji">{r.char}</span>
								<span class="reaction-count">{count}</span>
							</button>
						{/if}
					{/each}

					<div class="reaction-add-wrap">
						<button
							class="reaction-add"
							onclick={() => (reactionPickerFor = reactionPickerFor === comment.id ? null : comment.id)}
							title="Add reaction"
							aria-label="Add reaction"
						>
							<Icon name="sparkles" size={14} />
						</button>
						{#if reactionPickerFor === comment.id}
							<div class="reaction-picker">
								{#each REACTIONS as r}
									<button
										class="reaction-picker-btn {comment.myReactions?.includes(r.key) ? 'mine' : ''}"
										onclick={() => toggleReaction(comment.id, r.key)}
										title={r.label}
									>
										{r.char}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/each}

		{#if data.user}
			{@const me = avatar(data.user.name ?? 'You')}
			<div class="comment-form">
				<div class="comment-form-avatar" style="background:linear-gradient(135deg, {me.from}, {me.to});">{me.initials}</div>
				<div class="comment-form-main">
					<textarea
						bind:value={commentBody}
						placeholder="Share a tip, a goal, or some hype…"
						rows="3"
						class="comment-input"
					></textarea>
					<div class="comment-form-footer">
						<div class="quick-prompts">
							{#each ['Just signed up! 🎉', 'Anyone else nervous? 😅', 'Going for a PB 💪'] as q}
								<button type="button" class="quick-prompt" onclick={() => (commentBody = commentBody ? commentBody : q)}>{q}</button>
							{/each}
						</div>
						<button
							onclick={submitComment}
							disabled={submitting || !commentBody.trim()}
							class="btn-post"
						>
							{submitting ? 'Posting…' : 'Post'}
						</button>
					</div>
				</div>
			</div>
		{:else}
			<p class="login-prompt">
				<a href="/login">Log in</a> to join the chat.
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
	.back-link :global(.back-ic) {
		transform: rotate(180deg);
		vertical-align: -2px;
	}

	/* ── Hero ── */
	.hero {
		position: relative;
		height: 200px;
		border-radius: var(--r-lg);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 12px;
		border: 1px solid var(--line);
	}
	.hero-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		z-index: 0;
	}
	:global(.hero-topo) {
		position: absolute;
		inset: 0;
		z-index: 0;
	}
	.hero-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(7,10,18,0.78) 100%);
		z-index: 1;
	}
	.hero-overlay-soft {
		background: linear-gradient(to bottom, rgba(7,10,18,0.05) 0%, rgba(7,10,18,0.55) 100%);
	}
	.hero-top,
	.hero-bottom {
		position: relative;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.hero-top {
		justify-content: space-between;
	}
	.hero-bottom {
		flex-wrap: wrap;
	}
	.hero-cat {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(10,14,23,0.6);
		backdrop-filter: blur(10px);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
		padding: 5px 11px;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--accent);
	}
	.hero-date {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		line-height: 1;
		min-width: 46px;
		padding: 6px 8px;
		border-radius: 12px;
		background: rgba(10,14,23,0.62);
		border: 1px solid var(--line-strong);
		backdrop-filter: blur(8px);
	}
	.hero-date strong {
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 700;
		color: #fff;
	}
	.hero-date small {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin-top: 2px;
	}
	.hero-tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		backdrop-filter: blur(8px);
	}
	.hero-tag-medal {
		color: #fde68a;
		background: rgba(251,191,36,0.16);
		border: 1px solid rgba(251,191,36,0.35);
	}
	.hero-tag-open {
		color: #86efac;
		background: rgba(34,197,94,0.16);
		border: 1px solid rgba(34,197,94,0.32);
	}
	.hero-tag-open .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #4ade80;
		box-shadow: 0 0 8px #4ade80;
	}
	.hero-tag-urgent {
		color: #ffd2bf;
		background: rgba(255,122,69,0.2);
		border: 1px solid rgba(255,122,69,0.45);
	}

	/* ── Content card ── */
	.content-card {
		background: var(--color-surface);
		border-radius: var(--r-lg);
		padding: 22px;
		border: 1px solid var(--line);
	}
	.title {
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 4.5vw, 1.9rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-strong);
		line-height: 1.15;
		margin-bottom: 10px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
		font-size: 0.88rem;
		color: var(--text-muted);
		margin-bottom: 12px;
	}
	.meta .sep {
		opacity: 0.4;
		margin: 0 2px;
	}
	.dist-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
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

	/* ── Key facts ── */
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 10px;
		margin: 16px 0 18px;
	}
	.fact {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--color-surface-2);
		border: 1px solid var(--line);
	}
	.fact-urgent {
		background: rgba(255,122,69,0.1);
		border-color: rgba(255,122,69,0.35);
	}
	.fact-ic {
		display: flex;
		color: var(--color-brand-dim);
		flex-shrink: 0;
	}
	.fact-urgent .fact-ic { color: var(--color-urgent); }
	.fact-text { display: flex; flex-direction: column; min-width: 0; }
	.fact-label {
		font-size: 0.68rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.fact-value {
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--text-strong);
		text-transform: capitalize;
	}
	.fact-urgent .fact-value { color: var(--color-urgent); }

	.verdict {
		font-size: 0.86rem;
		line-height: 1.5;
		color: var(--text);
		font-style: italic;
		padding-left: 11px;
		border-left: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
		margin-bottom: 16px;
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px;
		border-radius: 13px;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text);
		background: rgba(255,255,255,0.05);
		border: 1.5px solid var(--line-strong);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-status:hover { background: rgba(255,255,255,0.09); }
	.btn-count {
		font-size: 0.74rem;
		padding: 1px 7px;
		border-radius: 999px;
		background: rgba(255,255,255,0.1);
		color: var(--text-muted);
	}
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
	.bib-searching {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.85rem;
		color: rgba(255,255,255,0.5);
		padding: 4px 0;
		animation: pulse-opacity 1.2s ease-in-out infinite;
	}
	@keyframes pulse-opacity {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.45; }
	}
	.bib-autofound {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.82rem;
		color: #a3e635;
		margin-bottom: 8px;
		padding: 6px 10px;
		border-radius: 8px;
		background: rgba(163,230,53,0.1);
		border: 1px solid rgba(163,230,53,0.25);
	}
	.bib-autofound strong { color: white; }
	.bib-no-result {
		font-size: 0.82rem;
		color: rgba(255,255,255,0.4);
		margin: 0 0 8px;
		font-style: italic;
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
	.my-result-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.my-result-name {
		font-size: 0.82rem;
		font-weight: 700;
		color: rgba(255,255,255,0.7);
	}
	.my-result-bib {
		font-size: 0.75rem;
		font-weight: 700;
		color: rgba(255,255,255,0.35);
		background: rgba(255,255,255,0.06);
		padding: 2px 7px;
		border-radius: 5px;
	}
	.my-result-dist {
		font-size: 0.78rem;
		color: rgba(255,255,255,0.4);
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

	/* ── Find a runner by BIB ── */
	.bib-search-card {
		background: #151a2e;
		border-radius: 1rem;
		padding: 16px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.bib-search-title {
		font-size: 1rem;
		font-weight: 800;
		color: white;
	}
	.bib-search-sub {
		font-size: 0.8rem;
		color: #94a3b8;
		margin: 4px 0 12px;
	}
	.bib-search-row {
		display: flex;
		gap: 8px;
	}
	.bib-search-input {
		flex: 1;
		min-width: 0;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(0,0,0,0.25);
		border: 1px solid rgba(255,255,255,0.1);
		color: #e6ecf4;
		font-size: 0.9rem;
	}
	.bib-search-input:focus {
		outline: none;
		border-color: rgba(163,230,53,0.5);
	}
	.bib-search-input:disabled { opacity: 0.6; }
	.btn-bib-search {
		padding: 10px 18px;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		background: #a3e635;
		color: #0f1320;
		white-space: nowrap;
		transition: filter 0.15s;
	}
	.btn-bib-search:hover:not(:disabled) { filter: brightness(1.08); }
	.btn-bib-search:disabled { opacity: 0.5; cursor: not-allowed; }
	.bib-search-result {
		display: grid;
		grid-template-columns: 40px 1fr auto;
		align-items: center;
		gap: 10px;
		margin-top: 12px;
		padding: 12px;
		border-radius: 12px;
		background: rgba(163,230,53,0.08);
		border: 1px solid rgba(163,230,53,0.2);
	}
	.bib-result-pos {
		font-weight: 800;
		color: #94a3b8;
		font-size: 0.95rem;
	}
	.bib-result-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.bib-result-name {
		color: white;
		font-weight: 700;
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.bib-result-num {
		font-size: 0.7rem;
		font-weight: 600;
		color: #a3e635;
		background: rgba(163,230,53,0.12);
		padding: 1px 7px;
		border-radius: 999px;
	}
	.bib-result-club {
		font-size: 0.74rem;
		color: #64748b;
	}
	.bib-result-meta {
		font-size: 0.74rem;
		color: #94a3b8;
	}
	.bib-result-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.9rem;
		font-weight: 700;
		color: #a3e635;
	}
	.bib-search-empty {
		margin-top: 12px;
		font-size: 0.82rem;
		color: #94a3b8;
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
	/* Fix with AI */
	.ai-fix {
		margin-top: 14px;
		padding: 14px;
		border-radius: 14px;
		background: rgba(139, 92, 246, 0.08);
		border: 1px solid rgba(139, 92, 246, 0.22);
	}
	.ai-fix-label {
		display: block;
		font-size: 0.85rem;
		font-weight: 800;
		color: #c4b5fd;
	}
	.ai-fix-hint {
		font-size: 0.78rem;
		line-height: 1.5;
		color: #9aa4b6;
		margin: 4px 0 10px;
	}
	.ai-fix-input {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #e6ecf4;
		font-size: 0.88rem;
		font-family: inherit;
		resize: vertical;
	}
	.ai-fix-input:focus {
		outline: none;
		border-color: rgba(139, 92, 246, 0.55);
	}
	.ai-fix-input:disabled { opacity: 0.6; }
	.btn-ai-fix {
		margin-top: 10px;
		padding: 9px 18px;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		background: linear-gradient(135deg, #8b5cf6, #6d28d9);
		color: white;
		transition: filter 0.15s;
	}
	.btn-ai-fix:hover:not(:disabled) { filter: brightness(1.12); }
	.btn-ai-fix:disabled { opacity: 0.5; cursor: not-allowed; }
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
		font-weight: 600;
		color: var(--color-brand, #c4f042);
		font-size: 0.78rem;
		background: rgba(196,240,66,0.1);
		padding: 2px 10px;
		border-radius: 999px;
	}

	/* ── About this race ── */
	.about-card {
		background: var(--color-surface, #151a2e);
		border-radius: var(--r-lg, 20px);
		padding: 20px 22px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.highlight-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 14px 0 4px;
	}
	.highlight-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 11px;
		border-radius: 999px;
		font-size: 0.76rem;
		font-weight: 600;
		color: #d7e0ee;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.07);
		text-transform: capitalize;
	}
	.highlight-chip :global(svg) { color: var(--color-brand, #c4f042); }
	.about-body {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 16px;
	}
	.about-para {
		font-size: 0.92rem;
		line-height: 1.65;
		color: #c3cdda;
	}
	.about-para:first-child {
		font-size: 1rem;
		color: #e6ecf4;
	}

	/* ── Race-day essentials ── */
	.essentials-card {
		background: var(--color-surface, #151a2e);
		border-radius: var(--r-lg, 20px);
		padding: 20px 22px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.essentials-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 14px 0 0;
		padding: 0;
	}
	.essential-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.essential-row:last-child { border-bottom: none; }
	.essential-ic {
		flex: 0 0 34px;
		width: 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: rgba(196,240,66,0.1);
		color: var(--color-brand, #c4f042);
		margin-top: 1px;
	}
	.essential-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.essential-label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #8b97a8;
	}
	.essential-value {
		font-size: 0.92rem;
		line-height: 1.5;
		color: #e6ecf4;
	}
	.essentials-missing {
		margin-top: 16px;
		padding: 13px 15px;
		border-radius: var(--r-md, 14px);
		background: rgba(255,255,255,0.03);
		border: 1px dashed rgba(255,255,255,0.12);
	}
	.missing-lead {
		font-size: 0.85rem;
		font-weight: 600;
		color: #c3cdda;
	}
	.missing-hint {
		font-size: 0.83rem;
		line-height: 1.55;
		color: #97a2b3;
		margin-top: 4px;
	}
	.missing-hint a {
		color: var(--color-brand, #c4f042);
		font-weight: 600;
		text-decoration: none;
	}
	.missing-hint a:hover { text-decoration: underline; }

	.comment-card {
		background: var(--color-surface, #151a2e);
		border-radius: var(--r-md, 14px);
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
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 800;
		color: #0c0f1a;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0,0,0,0.25);
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

	/* ── Reactions ── */
	.reaction-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}
	.reaction-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px 3px 7px;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		color: #c3cdda;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		cursor: pointer;
		transition: transform 0.12s var(--ease-spring, ease), background 0.15s, border-color 0.15s;
	}
	.reaction-chip:hover { transform: translateY(-1px); background: rgba(255,255,255,0.09); }
	.reaction-chip:active { transform: scale(0.94); }
	.reaction-chip.mine {
		background: rgba(196,240,66,0.14);
		border-color: rgba(196,240,66,0.45);
		color: var(--color-brand, #c4f042);
	}
	.reaction-emoji { font-size: 0.9rem; line-height: 1; }
	.reaction-count { font-variant-numeric: tabular-nums; }

	.reaction-add-wrap { position: relative; display: inline-flex; }
	.reaction-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 26px;
		border-radius: 999px;
		color: #64748b;
		background: rgba(255,255,255,0.04);
		border: 1px dashed rgba(255,255,255,0.14);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.reaction-add:hover { color: var(--color-brand, #c4f042); border-color: rgba(196,240,66,0.4); }
	.reaction-picker {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: 10;
		display: flex;
		gap: 2px;
		padding: 6px;
		border-radius: 14px;
		background: #0c0f1a;
		border: 1px solid rgba(255,255,255,0.12);
		box-shadow: 0 8px 28px rgba(0,0,0,0.5);
	}
	.reaction-picker-btn {
		font-size: 1.15rem;
		line-height: 1;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: none;
		border: none;
		cursor: pointer;
		transition: transform 0.12s var(--ease-spring, ease), background 0.15s;
	}
	.reaction-picker-btn:hover { transform: scale(1.25); background: rgba(255,255,255,0.08); }
	.reaction-picker-btn.mine { background: rgba(196,240,66,0.16); }

	/* ── Empty state ── */
	.comments-empty {
		text-align: center;
		padding: 28px 16px;
		border-radius: var(--r-md, 14px);
		background: rgba(255,255,255,0.025);
		border: 1px dashed rgba(255,255,255,0.1);
	}
	.comments-empty-emoji { font-size: 1.8rem; }
	.comments-empty-title {
		margin-top: 6px;
		font-size: 0.95rem;
		font-weight: 800;
		color: #e6ecf4;
	}
	.comments-empty-sub {
		margin-top: 3px;
		font-size: 0.82rem;
		color: #64748b;
	}

	.comment-form {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.comment-form-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.74rem;
		font-weight: 800;
		color: #0c0f1a;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0,0,0,0.25);
	}
	.comment-form-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.comment-form-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}
	.quick-prompts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.quick-prompt {
		font-size: 0.74rem;
		font-weight: 600;
		color: #9fb0c3;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 999px;
		padding: 5px 10px;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.quick-prompt:hover { background: rgba(196,240,66,0.12); color: var(--color-brand, #c4f042); }
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
	.comment-input:focus { border-color: rgba(196,240,66,0.4); }

	.btn-post {
		padding: 11px 22px;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 800;
		color: #0c0f1a;
		background: var(--color-brand, #c4f042);
		border: none;
		cursor: pointer;
		transition: background 0.15s, transform 0.12s;
	}
	.btn-post:hover { background: #d4ff5c; }
	.btn-post:active { transform: scale(0.96); }
	.btn-post:disabled { opacity: 0.4; cursor: default; }

	.login-prompt {
		font-size: 0.85rem;
		color: #64748b;
	}
	.login-prompt a {
		color: var(--color-brand, #c4f042);
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
