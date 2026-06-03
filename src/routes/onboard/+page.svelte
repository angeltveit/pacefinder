<script lang="ts">
	import { enhance } from '$app/forms';

	let { data } = $props();

	// ── Wizard state ──────────────────────────────────────────
	let step = $state(1); // 1 = location, 2 = running style
	const TOTAL_STEPS = 2;

	// Step 1 — location
	let city = $state('');
	let country = $state('NO');
	let homeLat = $state('');
	let homeLng = $state('');
	let locating = $state(false);
	let locateMsg = $state('');

	// Step 2 — running style
	let selectedDistances = $state(new Set<string>());
	let ambition = $state('');
	let gender = $state('');

	// Submitting state
	let submitting = $state(false);

	const distanceOptions = [
		{ value: '5k', label: '5K', emoji: '🏃' },
		{ value: '10k', label: '10K', emoji: '⚡' },
		{ value: 'half', label: 'Half', emoji: '🏅' },
		{ value: 'marathon', label: 'Marathon', emoji: '🎽' },
		{ value: 'ultra', label: 'Ultra', emoji: '🏔️' },
		{ value: 'trail', label: 'Trail', emoji: '🌲' }
	];

	const countries = [
		{ code: 'NO', name: 'Norway' },
		{ code: 'SE', name: 'Sweden' },
		{ code: 'DK', name: 'Denmark' },
		{ code: 'FI', name: 'Finland' },
		{ code: 'IS', name: 'Iceland' },
		{ code: 'DE', name: 'Germany' },
		{ code: 'NL', name: 'Netherlands' },
		{ code: 'GB', name: 'United Kingdom' },
		{ code: 'FR', name: 'France' },
		{ code: 'ES', name: 'Spain' },
		{ code: 'IT', name: 'Italy' },
		{ code: 'CH', name: 'Switzerland' },
		{ code: 'AT', name: 'Austria' },
		{ code: 'US', name: 'United States' },
		{ code: 'CA', name: 'Canada' },
		{ code: 'AU', name: 'Australia' },
		{ code: 'NZ', name: 'New Zealand' },
		{ code: 'JP', name: 'Japan' },
		{ code: 'OTHER', name: 'Other' }
	];

	function toggleDistance(value: string) {
		const next = new Set(selectedDistances);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		selectedDistances = next;
	}

	async function detectLocation() {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			locateMsg = 'Geolocation not available in this browser.';
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
						body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude })
					});
					const out = await res.json();
					if (out.ok) {
						homeLat = String(pos.coords.latitude);
						homeLng = String(pos.coords.longitude);
						if (out.city) city = out.city;
						if (out.country) country = out.country;
						locateMsg = `📍 Got it — ${out.city ?? 'location'} detected`;
					}
				} catch {
					locateMsg = 'Could not detect city. Enter it manually.';
				} finally {
					locating = false;
				}
			},
			() => {
				locateMsg = 'Location blocked — please enter your city manually.';
				locating = false;
			},
			{ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
		);
	}

	const radiusStops  = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 9999];
	const radiusLabels = ['5 km','10 km','15 km','20 km','25 km','30 km','35 km','40 km','45 km','50 km','55 km','60 km','65 km','70 km','75 km','80 km','85 km','90 km','95 km','100 km','∞ No limit'];
	const MAX_IDX = radiusStops.length - 1;

	// Use index-based slider so snapping is natural (no reactive loop)
	let radiusIndex = $state(19); // default: 100 km
	const travelRadiusKm = $derived(radiusStops[radiusIndex]);
</script>

<div class="onboard-shell">
	<a href="/" class="logo-link" aria-label="PaceFinder home">
		<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
			<polygon points="14,2 26,26 14,20 2,26" fill="#a3e635" opacity="0.9" />
		</svg>
		<span>PaceFinder</span>
	</a>

	<div class="wizard-card">
		<!-- Progress -->
		<div class="progress-bar" aria-label="Step {step} of {TOTAL_STEPS}">
			{#each Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1) as s}
				<div class="progress-dot {s < step ? 'done' : s === step ? 'active' : ''}"></div>
			{/each}
		</div>

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<!-- Hidden coords passed from GPS -->
			<input type="hidden" name="homeLat" value={homeLat} />
			<input type="hidden" name="homeLng" value={homeLng} />
			<!-- Hidden values from all steps so they're always in the form payload -->
			<input type="hidden" name="travelRadiusKm" value={travelRadiusKm} />
			<input type="hidden" name="ambition" value={ambition} />
			<input type="hidden" name="gender" value={gender} />
			{#each selectedDistances as d}
				<input type="hidden" name="targetDistances" value={d} />
			{/each}

			<!-- ══════════════════════════════════════════════════
			     STEP 1 — LOCATION
			     ══════════════════════════════════════════════════ -->
			{#if step === 1}
				<div class="step-header">
					<div class="step-icon">📍</div>
					<h1>Where do you run?</h1>
					<p class="step-desc">
						We'll surface races within reach and hide the ones that are too far away —
						no more scrolling past events on another continent.
					</p>
				</div>

				<div class="fields">
					<div class="gps-row">
						<button
							type="button"
							class="gps-btn {locating ? 'loading' : ''}"
							onclick={detectLocation}
							disabled={locating}
						>
							{#if locating}
								<span class="spinner"></span> Detecting…
							{:else}
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
									<circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
									<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
								</svg>
								Use my current location
							{/if}
						</button>
						{#if locateMsg}
							<span class="locate-msg {locateMsg.startsWith('📍') ? 'ok' : 'err'}">{locateMsg}</span>
						{/if}
					</div>

					<div class="field-divider"><span>or enter manually</span></div>

					<div class="field-row">
						<label class="field">
							<span>City</span>
							<input
								type="text"
								name="city"
								placeholder="e.g. Oslo"
								bind:value={city}
								autocomplete="address-level2"
							/>
						</label>
						<label class="field field-country">
							<span>Country</span>
							<select name="country" bind:value={country}>
								{#each countries as c}
									<option value={c.code}>{c.name}</option>
								{/each}
							</select>
						</label>
					</div>

					<label class="field">
						<span class="radius-label">
							Travel radius
							<strong class="radius-value">{radiusLabels[radiusIndex]}</strong>
						</span>
						<input
							type="range"
							min="0"
							max={MAX_IDX}
							step="1"
							class="radius-slider"
							style="--pct: {(radiusIndex / MAX_IDX * 100).toFixed(1)}%"
							bind:value={radiusIndex}
						/>
						<div class="radius-hint">
							{radiusIndex === MAX_IDX
								? 'Every race worldwide will appear in your feed.'
								: 'Only races within this distance will appear in your feed.'}
						</div>
					</label>
				</div>

				<div class="wizard-actions">
					<button type="button" class="btn-primary" onclick={() => (step = 2)}>
						Continue →
					</button>
					<a href="/" class="skip-link">Skip for now</a>
				</div>
			{/if}

			<!-- ══════════════════════════════════════════════════
			     STEP 2 — RUNNING STYLE
			     ══════════════════════════════════════════════════ -->
			{#if step === 2}
				<div class="step-header">
					<div class="step-icon">🎽</div>
					<h1>What's your game?</h1>
					<p class="step-desc">
						Tell us what you race and how seriously you take it. We'll match you with
						events that fit your goals — not just the most popular ones.
					</p>
				</div>

				<div class="fields">
					<fieldset class="field-group">
						<legend>Distances you love <span class="optional">(pick any)</span></legend>
						<div class="chip-grid">
							{#each distanceOptions as opt}
								<button
									type="button"
									class="chip {selectedDistances.has(opt.value) ? 'selected' : ''}"
									onclick={() => toggleDistance(opt.value)}
									aria-pressed={selectedDistances.has(opt.value)}
								>
									<span class="chip-emoji">{opt.emoji}</span>
									{opt.label}
								</button>
							{/each}
						</div>
					</fieldset>

					<fieldset class="field-group">
						<legend>Your vibe <span class="optional">(optional)</span></legend>
						<div class="ambition-cards">
							{#each [
								{ value: 'casual', label: 'Casual', sub: 'Running for the joy of it', emoji: '😊' },
								{ value: 'improver', label: 'Improver', sub: 'Chasing a PB every season', emoji: '📈' },
								{ value: 'competitive', label: 'Competitive', sub: 'Racing to place, not just finish', emoji: '🏆' }
							] as opt}
								<button
									type="button"
									class="ambition-card {ambition === opt.value ? 'selected' : ''}"
									onclick={() => (ambition = ambition === opt.value ? '' : opt.value)}
									aria-pressed={ambition === opt.value}
								>
									<span class="ambition-emoji">{opt.emoji}</span>
									<span class="ambition-label">{opt.label}</span>
									<span class="ambition-sub">{opt.sub}</span>
								</button>
							{/each}
						</div>
					</fieldset>

					<fieldset class="field-group">
						<legend>Gender <span class="optional">(optional — helps the AI coach personalise nicknames)</span></legend>
						<div class="gender-pills">
							{#each [
								{ value: 'male', label: 'Male' },
								{ value: 'female', label: 'Female' },
								{ value: 'other', label: 'Non-binary / other' }
							] as opt}
								<button
									type="button"
									class="gender-pill {gender === opt.value ? 'selected' : ''}"
									onclick={() => (gender = gender === opt.value ? '' : opt.value)}
									aria-pressed={gender === opt.value}
								>
									{opt.label}
								</button>
							{/each}
						</div>
					</fieldset>
				</div>

				<div class="wizard-actions">
					<button type="button" class="btn-back" onclick={() => (step = 1)}>← Back</button>
					<button type="submit" class="btn-primary" disabled={submitting}>
						{submitting ? 'Saving…' : 'Find my races ⚡'}
					</button>
				</div>
				<a href="/" class="skip-link center">Skip and go straight in</a>
			{/if}
		</form>
	</div>
</div>

<style>
	:global(body) {
		background: #080c15;
	}

	.onboard-shell {
		position: fixed;
		inset: 0;
		z-index: 1000;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 2rem 1rem 4rem;
		background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(163, 230, 53, 0.08) 0%, transparent 70%),
			#080c15;
	}

	/* Logo */
	.logo-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: #f0f4ff;
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin-bottom: 2.5rem;
		opacity: 0.9;
	}
	.logo-link:hover { opacity: 1; }

	/* Card */
	.wizard-card {
		width: 100%;
		max-width: 480px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 1.25rem;
		padding: 2rem 2rem 2.5rem;
		backdrop-filter: blur(12px);
	}

	/* Progress */
	.progress-bar {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 2rem;
	}
	.progress-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		transition: all 0.2s;
	}
	.progress-dot.active {
		background: #a3e635;
		width: 24px;
		border-radius: 4px;
		box-shadow: 0 0 8px rgba(163, 230, 53, 0.5);
	}
	.progress-dot.done {
		background: rgba(163, 230, 53, 0.4);
	}

	/* Step header */
	.step-header {
		text-align: center;
		margin-bottom: 2rem;
	}
	.step-icon {
		font-size: 2.5rem;
		margin-bottom: 0.75rem;
		line-height: 1;
	}
	h1 {
		font-size: 1.6rem;
		font-weight: 800;
		color: #f0f4ff;
		margin: 0 0 0.75rem;
		letter-spacing: -0.03em;
	}
	.step-desc {
		font-size: 0.9rem;
		color: rgba(240, 244, 255, 0.55);
		line-height: 1.6;
		margin: 0;
		max-width: 360px;
		margin-inline: auto;
	}

	/* Fields */
	.fields {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-bottom: 2rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field span {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(240, 244, 255, 0.6);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.field input[type='text'],
	.field select {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.6rem;
		color: #f0f4ff;
		font-size: 0.95rem;
		padding: 0.65rem 0.85rem;
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
		-webkit-appearance: none;
		appearance: none;
	}
	.field select {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(240,244,255,0.4)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.85rem center;
		padding-right: 2.25rem;
	}
	.field input:focus,
	.field select:focus {
		border-color: rgba(163, 230, 53, 0.5);
		box-shadow: 0 0 0 3px rgba(163, 230, 53, 0.08);
	}
	.field select option {
		background: #141824;
		color: #f0f4ff;
	}

	.field-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.75rem;
		align-items: end;
	}
	.field-country { min-width: 160px; }

	/* GPS button */
	.gps-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.gps-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(163, 230, 53, 0.1);
		border: 1px solid rgba(163, 230, 53, 0.3);
		border-radius: 0.6rem;
		color: #a3e635;
		font-size: 0.875rem;
		font-weight: 600;
		padding: 0.55rem 1rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.gps-btn:hover:not(:disabled) {
		background: rgba(163, 230, 53, 0.18);
		border-color: rgba(163, 230, 53, 0.5);
	}
	.gps-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.locate-msg {
		font-size: 0.8rem;
	}
	.locate-msg.ok { color: #a3e635; }
	.locate-msg.err { color: rgba(240, 244, 255, 0.5); }

	/* Divider */
	.field-divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: rgba(240, 244, 255, 0.2);
		font-size: 0.75rem;
	}
	.field-divider::before,
	.field-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: rgba(255, 255, 255, 0.07);
	}

	/* Radius slider */
	.radius-label {
		display: flex !important;
		flex-direction: row !important;
		justify-content: space-between;
		align-items: center;
	}
	.radius-value {
		color: #a3e635;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.radius-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			#a3e635 var(--pct, 44.4%),
			rgba(255, 255, 255, 0.1) var(--pct, 44.4%)
		);
		outline: none;
		cursor: pointer;
	}
	.radius-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #a3e635;
		box-shadow: 0 0 0 3px rgba(163, 230, 53, 0.2);
		cursor: pointer;
		transition: box-shadow 0.15s;
	}
	.radius-slider::-webkit-slider-thumb:hover {
		box-shadow: 0 0 0 5px rgba(163, 230, 53, 0.3);
	}
	.radius-hint {
		font-size: 0.75rem;
		color: rgba(240, 244, 255, 0.35);
		margin-top: 0.35rem;
	}

	/* Fieldsets */
	.field-group {
		border: none;
		padding: 0;
		margin: 0;
	}
	.field-group legend {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(240, 244, 255, 0.6);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin-bottom: 0.75rem;
		display: block;
		width: 100%;
	}
	.optional {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: rgba(240, 244, 255, 0.35);
	}

	/* Distance chips */
	.chip-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 2rem;
		color: rgba(240, 244, 255, 0.7);
		font-size: 0.875rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.chip:hover {
		background: rgba(163, 230, 53, 0.08);
		border-color: rgba(163, 230, 53, 0.3);
		color: #a3e635;
	}
	.chip.selected {
		background: rgba(163, 230, 53, 0.15);
		border-color: #a3e635;
		color: #a3e635;
	}
	.chip-emoji { font-style: normal; }

	/* Ambition cards */
	.ambition-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}
	.ambition-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.75rem;
		padding: 0.85rem 0.5rem;
		cursor: pointer;
		transition: all 0.15s;
		text-align: center;
	}
	.ambition-card:hover {
		background: rgba(163, 230, 53, 0.06);
		border-color: rgba(163, 230, 53, 0.25);
	}
	.ambition-card.selected {
		background: rgba(163, 230, 53, 0.12);
		border-color: #a3e635;
	}
	.ambition-emoji { font-size: 1.5rem; line-height: 1; }
	.ambition-label {
		font-size: 0.8rem;
		font-weight: 700;
		color: #f0f4ff;
	}
	.ambition-sub {
		font-size: 0.7rem;
		color: rgba(240, 244, 255, 0.4);
		line-height: 1.3;
	}

	/* Gender pills */
	.gender-pills {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.gender-pill {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 2rem;
		color: rgba(240, 244, 255, 0.65);
		font-size: 0.875rem;
		font-weight: 500;
		padding: 0.45rem 1rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.gender-pill:hover {
		background: rgba(163, 230, 53, 0.08);
		border-color: rgba(163, 230, 53, 0.3);
		color: #a3e635;
	}
	.gender-pill.selected {
		background: rgba(163, 230, 53, 0.15);
		border-color: #a3e635;
		color: #a3e635;
	}

	/* Actions */
	.wizard-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	.btn-primary {
		flex: 1;
		background: #a3e635;
		color: #0a0e17;
		border: none;
		border-radius: 0.7rem;
		font-size: 1rem;
		font-weight: 800;
		padding: 0.85rem 1.5rem;
		cursor: pointer;
		transition: all 0.15s;
		letter-spacing: -0.01em;
	}
	.btn-primary:hover:not(:disabled) {
		background: #b5f044;
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(163, 230, 53, 0.3);
	}
	.btn-primary:active:not(:disabled) { transform: translateY(0); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-back {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 0.7rem;
		color: rgba(240, 244, 255, 0.6);
		font-size: 0.875rem;
		font-weight: 600;
		padding: 0.85rem 1.1rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.btn-back:hover {
		border-color: rgba(255, 255, 255, 0.25);
		color: #f0f4ff;
	}

	.skip-link {
		display: block;
		text-align: center;
		margin-top: 1.25rem;
		font-size: 0.8rem;
		color: rgba(240, 244, 255, 0.3);
		text-decoration: none;
		transition: color 0.15s;
	}
	.skip-link:hover { color: rgba(240, 244, 255, 0.6); }

	/* Spinner */
	.spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(163, 230, 53, 0.3);
		border-top-color: #a3e635;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 520px) {
		.wizard-card { padding: 1.5rem 1.25rem 2rem; }
		.ambition-cards { grid-template-columns: 1fr; }
		.field-row { grid-template-columns: 1fr; }
		.field-country { min-width: unset; }
	}
</style>
