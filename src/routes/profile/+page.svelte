<script lang="ts">
	let { data } = $props();

	const distanceOptions = [
		{ value: '5k', label: '5K' },
		{ value: '10k', label: '10K' },
		{ value: 'half', label: 'Half' },
		{ value: 'marathon', label: 'Marathon' },
		{ value: 'ultra', label: 'Ultra' },
		{ value: 'trail', label: 'Trail' }
	];
	const ambitionOptions = [
		{ value: '', label: 'No preference' },
		{ value: 'casual', label: 'Casual — just for fun' },
		{ value: 'improver', label: 'Improver — chasing PBs' },
		{ value: 'competitive', label: 'Competitive — racing to win' }
	];

	// Local editable copies for the location form
	let city = $state(data.userCity);
	let country = $state(data.userCountry);
	let travelRadiusKm = $state(data.userTravelRadiusKm);
	let selectedDistances = $state(new Set(data.userTargetDistances));
	let locating = $state(false);
	let locateMsg = $state('');

	// Re-sync local copies when load re-runs (e.g. after saving the form)
	$effect(() => {
		city = data.userCity;
		country = data.userCountry;
		travelRadiusKm = data.userTravelRadiusKm;
		selectedDistances = new Set(data.userTargetDistances);
	});

	function toggleDistance(value: string) {
		const next = new Set(selectedDistances);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		selectedDistances = next;
	}

	async function detectLocation() {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			locateMsg = 'Geolocation not supported in this browser.';
			return;
		}
		locating = true;
		locateMsg = '';
		navigator.geolocation.getCurrentPosition(
			async (pos) => {
				try {
					const res = await fetch('/api/profile/locate', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							lat: pos.coords.latitude,
							lng: pos.coords.longitude
						})
					});
					const out = await res.json();
					if (res.ok) {
						if (out.city) city = out.city;
						if (out.country) country = out.country;
						locateMsg = `Pinned to ${out.city ?? 'your location'} ✓`;
					} else {
						locateMsg = 'Could not save your location.';
					}
				} catch {
					locateMsg = 'Could not save your location.';
				} finally {
					locating = false;
				}
			},
			() => {
				locating = false;
				locateMsg = 'Location permission denied.';
			},
			{ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
		);
	}

	const statusGroups = ['attending', 'interested', 'following', 'seen', 'skip'] as const;
	const statusLabels: Record<string, string> = {
		attending: '🏁 Attending',
		interested: '❤️ Interested',
		following: '🔔 Following',
		seen: '✓ Seen',
		skip: '✕ Skipped'
	};
	const catLabel: Record<string, string> = {
		local: 'Local',
		norway: 'Norway',
		international: 'International'
	};
	const catCls: Record<string, string> = {
		local: 'cat-local',
		norway: 'cat-norway',
		international: 'cat-intl'
	};
	const medalLabel: Record<string, string> = {
		confirmed: '🏅 Medal confirmed',
		likely: '🥈 Medal likely',
		unclear: 'Medal unclear'
	};
	const medalCls: Record<string, string> = {
		confirmed: 'medal-confirmed',
		likely: 'medal-likely',
		unclear: 'medal-unclear'
	};

	function grouped(status: string) {
		return data.triaged.filter((t) => t.status === status);
	}

	function formatDate(d: string | null) {
		if (!d) return null;
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head><title>My Profile — PaceFinder</title></svelte:head>

<div class="profile-wrap">
	<div class="profile-header">
		<h1 class="profile-title">My Profile</h1>
	</div>

	<!-- Location & preferences -->
	<form class="location-form" method="POST" action="?/updateLocation">
		<div class="section-head">
			<h2 class="section-label">📍 My Location</h2>
			<button type="button" class="detect-btn" onclick={detectLocation} disabled={locating}>
				{locating ? 'Locating…' : 'Use my current location'}
			</button>
		</div>
		<div class="location-fields">
			<input type="text" name="city" placeholder="City (e.g. Oslo)" bind:value={city} class="loc-input" />
			<input type="text" name="country" placeholder="Country (e.g. NO)" bind:value={country} maxlength="2" class="loc-input loc-country" />
			<select name="gender" value={data.userGender} class="loc-input loc-gender">
				<option value="">Gender (optional)</option>
				<option value="male">Male</option>
				<option value="female">Female</option>
				<option value="other">Other</option>
			</select>
		</div>
		{#if locateMsg}<p class="locate-msg">{locateMsg}</p>{/if}

		<h2 class="section-label pref-label">🏃 How far will you travel?</h2>
		<div class="radius-row">
			<input
				type="range"
				name="travelRadiusKm"
				min="10"
				max="1000"
				step="10"
				bind:value={travelRadiusKm}
				class="radius-slider"
			/>
			<span class="radius-val">{travelRadiusKm} km</span>
		</div>

		<h2 class="section-label pref-label">🎯 Favourite distances</h2>
		<div class="chip-group">
			{#each distanceOptions as d}
				<label class="dist-chip {selectedDistances.has(d.value) ? 'on' : ''}">
					<input
						type="checkbox"
						name="targetDistances"
						value={d.value}
						checked={selectedDistances.has(d.value)}
						onchange={() => toggleDistance(d.value)}
					/>
					{d.label}
				</label>
			{/each}
		</div>

		<h2 class="section-label pref-label">🔥 Ambition</h2>
		<select name="ambition" value={data.userAmbition} class="loc-input ambition-select">
			{#each ambitionOptions as a}
				<option value={a.value}>{a.label}</option>
			{/each}
		</select>

		<button type="submit" class="loc-save">Save preferences</button>
		<p class="loc-hint">Your location, travel radius and favourite distances power the "For You" feed.</p>
	</form>

	<div class="profile-header">
		<h2 class="profile-title">My Races</h2>
		<span class="profile-count">{data.triaged.length} triaged</span>
	</div>

	{#if data.triaged.length === 0}
		<div class="empty-state">
			<p class="empty-text">You haven't triaged any races yet.</p>
			<a href="/races" class="empty-link">Browse races →</a>
		</div>
	{:else}
		{#each statusGroups as status}
			{#if grouped(status).length > 0}
				<div class="status-group">
					<h2 class="status-label">{statusLabels[status]}</h2>
					<div class="race-list">
						{#each grouped(status) as item}
							<a href="/races/{item.race.id}" class="race-card">
								<div class="race-main">
									<p class="race-name">{item.race.name}</p>
									<div class="race-meta">
										<span class="badge {catCls[item.race.category] ?? 'cat-local'}">
											{catLabel[item.race.category] ?? item.race.category}
										</span>
										<span class="badge {medalCls[item.race.medalStatus] ?? 'medal-unclear'}">
											{medalLabel[item.race.medalStatus] ?? 'Medal unclear'}
										</span>
										{#if item.race.raceDate}
											<span class="race-date">{formatDate(item.race.raceDate)}</span>
										{/if}
									</div>
									{#if item.notes}
										<p class="race-notes">{item.notes}</p>
									{/if}
								</div>
								<span class="race-updated">{formatDate(item.updatedAt)}</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.profile-wrap {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.profile-header {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	.profile-title {
		font-size: 1.5rem;
		font-weight: 800;
		color: #f1f5f9;
		margin: 0;
	}
	.profile-count {
		font-size: 0.8rem;
		color: rgba(255,255,255,0.4);
		font-weight: 500;
	}
	.empty-state {
		background: rgba(255,255,255,0.04);
		border: 1.5px dashed rgba(255,255,255,0.12);
		border-radius: 16px;
		padding: 48px 24px;
		text-align: center;
	}
	.empty-text {
		color: rgba(255,255,255,0.45);
		margin: 0 0 16px;
	}
	.empty-link {
		color: #a3e635;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
	}
	.empty-link:hover { text-decoration: underline; }

	.status-group {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status-label {
		font-size: 0.85rem;
		font-weight: 700;
		color: #a3e635;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0;
	}
	.race-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.race-card {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		padding: 14px 16px;
		text-decoration: none;
		transition: background 0.15s, border-color 0.15s;
	}
	.race-card:hover {
		background: rgba(255,255,255,0.08);
		border-color: rgba(163,230,53,0.3);
	}
	.race-main {
		min-width: 0;
		flex: 1;
	}
	.race-name {
		font-weight: 600;
		font-size: 0.95rem;
		color: #f1f5f9;
		margin: 0 0 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.race-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		border-radius: 99px;
		border: 1px solid;
		padding: 1px 8px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.cat-local    { background: rgba(96,165,250,0.15); color: #93c5fd; border-color: rgba(96,165,250,0.3); }
	.cat-norway   { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.3); }
	.cat-intl     { background: rgba(251,146,60,0.15); color: #fdba74; border-color: rgba(251,146,60,0.3); }
	.medal-confirmed { background: rgba(163,230,53,0.15); color: #a3e635; border-color: rgba(163,230,53,0.3); }
	.medal-likely    { background: rgba(52,211,153,0.15); color: #6ee7b7; border-color: rgba(52,211,153,0.3); }
	.medal-unclear   { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.25); }
	.race-date {
		font-size: 0.75rem;
		color: rgba(255,255,255,0.4);
	}
	.race-notes {
		margin: 6px 0 0;
		font-size: 0.75rem;
		color: rgba(255,255,255,0.4);
		font-style: italic;
	}
	.race-updated {
		font-size: 0.7rem;
		color: rgba(255,255,255,0.3);
		white-space: nowrap;
		flex-shrink: 0;
		padding-top: 2px;
	}

	.location-form {
		background: rgba(255,255,255,0.03);
		border: 1.5px solid rgba(255,255,255,0.08);
		border-radius: 16px;
		padding: 20px;
	}
	.section-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0 0 12px;
	}
	.location-fields {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.loc-input {
		flex: 1;
		min-width: 120px;
		padding: 10px 14px;
		border-radius: 10px;
		font-size: 0.85rem;
		color: white;
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.1);
		outline: none;
	}
	.loc-input:focus {
		border-color: rgba(163,230,53,0.4);
	}
	.loc-country {
		flex: 0 0 80px;
		min-width: 80px;
		text-transform: uppercase;
	}
	.loc-save {
		padding: 10px 20px;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 700;
		color: #0c0f1a;
		background: #a3e635;
		border: none;
		cursor: pointer;
	}
	.loc-save:hover {
		background: #bef264;
	}
	.loc-hint {
		margin: 8px 0 0;
		font-size: 0.75rem;
		color: rgba(255,255,255,0.35);
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.detect-btn {
		padding: 7px 14px;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		color: #a3e635;
		background: rgba(163,230,53,0.1);
		border: 1px solid rgba(163,230,53,0.3);
		cursor: pointer;
		transition: background 0.15s;
	}
	.detect-btn:hover:not(:disabled) {
		background: rgba(163,230,53,0.18);
	}
	.detect-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.locate-msg {
		margin: 8px 0 0;
		font-size: 0.78rem;
		color: #a3e635;
	}
	.pref-label {
		margin-top: 20px;
		font-size: 0.85rem;
	}
	.radius-row {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.radius-slider {
		flex: 1;
		accent-color: #a3e635;
		cursor: pointer;
	}
	.radius-val {
		flex: 0 0 auto;
		font-size: 0.85rem;
		font-weight: 700;
		color: #a3e635;
		min-width: 64px;
		text-align: right;
	}
	.chip-group {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.dist-chip {
		display: inline-flex;
		align-items: center;
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 0.82rem;
		font-weight: 600;
		color: rgba(255,255,255,0.7);
		background: rgba(255,255,255,0.05);
		border: 1.5px solid rgba(255,255,255,0.1);
		cursor: pointer;
		user-select: none;
		transition: all 0.15s;
	}
	.dist-chip.on {
		color: #0c0f1a;
		background: #a3e635;
		border-color: #a3e635;
	}
	.dist-chip input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.ambition-select {
		flex: none;
		width: 100%;
		max-width: 340px;
	}
	.loc-save {
		margin-top: 22px;
	}
</style>
