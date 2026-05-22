<script lang="ts">
	import CategoryBadge from './CategoryBadge.svelte';
	import MedalBadge from './MedalBadge.svelte';
	import RegStatusBadge from './RegStatusBadge.svelte';
	import TriageButtons from './TriageButtons.svelte';

	interface Race {
		id: string;
		name: string;
		category: string;
		distanceKm: number | null;
		city: string;
		country: string;
		raceDate: string | null;
		medalStatus: string;
		registrationStatus: string;
		registrationUrl: string | null;
		whyItFits: string | null;
		interestedCount: number;
		commentCount: number;
		myStatus: string | null;
	}

	interface Props {
		race: Race;
		user: { id: string; role: string } | null;
	}

	let { race, user }: Props = $props();

	function formatDate(d: string | null) {
		if (!d) return null;
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function formatDistance(km: number | null) {
		if (!km) return null;
		if (km === 42.195 || km === 42) return 'Marathon';
		if (km === 21.097 || km === 21) return 'Half Marathon';
		return `${km} km`;
	}
</script>

<article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
	<a href="/races/{race.id}" class="block">
		<!-- Header row -->
		<div class="mb-3 flex flex-wrap items-start justify-between gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<CategoryBadge category={race.category} />
				{#if race.distanceKm}
					<span class="text-sm font-semibold text-slate-700">{formatDistance(race.distanceKm)}</span>
				{/if}
			</div>
			<MedalBadge status={race.medalStatus} />
		</div>

		<!-- Title -->
		<h2 class="mb-1 text-lg font-bold text-slate-900 leading-snug hover:text-blue-600 transition-colors">
			{race.name}
		</h2>

		<!-- Meta row -->
		<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
			<span class="flex items-center gap-1">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				{race.city}{race.country !== 'NO' ? `, ${race.country}` : ''}
			</span>
			{#if race.raceDate}
				<span class="flex items-center gap-1">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
					</svg>
					{formatDate(race.raceDate)}
				</span>
			{/if}
		</div>

		<!-- Why it fits -->
		{#if race.whyItFits}
			<p class="mb-3 text-sm text-slate-600 leading-relaxed">{race.whyItFits}</p>
		{/if}

		<!-- Registration status -->
		<div class="mb-4">
			<RegStatusBadge status={race.registrationStatus} />
		</div>
	</a>

	<!-- Footer: social + triage -->
	<div class="flex items-center justify-between border-t border-slate-100 pt-3">
		<div class="flex items-center gap-4 text-sm text-slate-500">
			<span class="flex items-center gap-1">
				<svg class="h-4 w-4 text-rose-400" fill="currentColor" viewBox="0 0 24 24">
					<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
				</svg>
				{race.interestedCount} interested
			</span>
			{#if race.commentCount > 0}
				<span class="flex items-center gap-1">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
							d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
					</svg>
					{race.commentCount}
				</span>
			{/if}
			{#if race.registrationUrl}
				<a
					href={race.registrationUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
					onclick={(e) => e.stopPropagation()}
				>
					Register →
				</a>
			{/if}
		</div>
		{#if user}
			<TriageButtons raceId={race.id} currentStatus={race.myStatus} />
		{/if}
	</div>
</article>
