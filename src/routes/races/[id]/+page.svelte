<script lang="ts">
	import { untrack } from 'svelte';
	import CategoryBadge from '$lib/components/CategoryBadge.svelte';
	import MedalBadge from '$lib/components/MedalBadge.svelte';
	import RegStatusBadge from '$lib/components/RegStatusBadge.svelte';
	import TriageButtons from '$lib/components/TriageButtons.svelte';

	let { data } = $props();

	let commentBody = $state('');
	let submitting = $state(false);
	let comments = $state(untrack(() => data.comments));
	let currentStatus = $state(untrack(() => data.myStatus));

	function formatDate(d: string | null) {
		if (!d) return null;
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function formatDistance(km: number | null) {
		if (!km) return null;
		if (km === 42.195 || km === 42) return 'Marathon';
		if (km === 21.097 || km === 21) return 'Half Marathon';
		return `${km} km`;
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
</script>

<svelte:head><title>{data.race.name} — RaceScout</title></svelte:head>

<div class="space-y-6">
	<!-- Back -->
	<a href="/races" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
		← Back to races
	</a>

	<!-- Race detail card -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<!-- Badges -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<CategoryBadge category={data.race.category} />
			{#if data.race.distanceKm}
				<span class="text-sm font-semibold text-slate-700">{formatDistance(data.race.distanceKm)}</span>
			{/if}
			<MedalBadge status={data.race.medalStatus} />
			<RegStatusBadge status={data.race.registrationStatus} />
		</div>

		<!-- Title -->
		<h1 class="mb-4 text-3xl font-bold text-slate-900">{data.race.name}</h1>

		<!-- Meta grid -->
		<dl class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
			<div>
				<dt class="text-xs font-medium uppercase tracking-wide text-slate-500">Location</dt>
				<dd class="mt-1 text-sm font-medium text-slate-900">
					{data.race.city}{data.race.country !== 'NO' ? `, ${data.race.country}` : ''}
					{#if data.race.location && data.race.location !== data.race.city}
						<br /><span class="text-slate-500">{data.race.location}</span>
					{/if}
				</dd>
			</div>
			{#if data.race.raceDate}
				<div>
					<dt class="text-xs font-medium uppercase tracking-wide text-slate-500">Date</dt>
					<dd class="mt-1 text-sm font-medium text-slate-900">{formatDate(data.race.raceDate)}</dd>
				</div>
			{/if}
			<div>
				<dt class="text-xs font-medium uppercase tracking-wide text-slate-500">Interested</dt>
				<dd class="mt-1 text-sm font-medium text-slate-900">{data.interestedCount} people</dd>
			</div>
		</dl>

		<!-- Why it fits -->
		{#if data.race.whyItFits}
			<div class="mb-6 rounded-xl bg-blue-50 p-4">
				<p class="text-sm font-medium text-blue-900">Why this race fits your profile</p>
				<p class="mt-1 text-sm text-blue-800">{data.race.whyItFits}</p>
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
			{#if data.race.registrationUrl}
				<a
					href={data.race.registrationUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
				>
					Register now →
				</a>
			{/if}
			{#if data.user}
				<TriageButtons raceId={data.race.id} bind:currentStatus />
			{/if}
		</div>
	</div>

	<!-- Source info -->
	{#if data.race.sourceUrl}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
			<span class="font-medium">Source:</span>
			<a href={data.race.sourceUrl} target="_blank" rel="noopener noreferrer" class="ml-1 text-blue-600 hover:underline break-all">
				{data.race.sourceUrl}
			</a>
			<span class="ml-4 text-slate-400">
				Found {new Date(data.race.firstSeenAt).toLocaleDateString('en-GB')}
			</span>
		</div>
	{/if}

	<!-- Comments -->
	<div class="space-y-4">
		<h2 class="text-lg font-bold text-slate-900">
			Comments
			{#if comments.length > 0}
				<span class="text-base font-normal text-slate-500">({comments.length})</span>
			{/if}
		</h2>

		{#each comments as comment (comment.id)}
			<div class="rounded-xl border border-slate-200 bg-white p-4">
				<div class="mb-2 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<div class="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
							{comment.authorName.charAt(0).toUpperCase()}
						</div>
						<span class="text-sm font-medium text-slate-900">{comment.authorName}</span>
						<span class="text-xs text-slate-400">
							{new Date(comment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
						</span>
					</div>
					{#if data.user?.role === 'admin'}
						<button
							onclick={() => deleteComment(comment.id)}
							class="text-xs text-red-400 hover:text-red-600"
						>Delete</button>
					{/if}
				</div>
				<p class="text-sm text-slate-700 leading-relaxed">{comment.body}</p>
			</div>
		{/each}

		{#if data.user}
			<div class="rounded-xl border border-slate-200 bg-white p-4">
				<textarea
					bind:value={commentBody}
					placeholder="Add a comment…"
					rows="3"
					class="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
				></textarea>
				<div class="mt-2 flex justify-end">
					<button
						onclick={submitComment}
						disabled={submitting || !commentBody.trim()}
						class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
					>
						{submitting ? 'Posting…' : 'Post comment'}
					</button>
				</div>
			</div>
		{:else}
			<p class="text-sm text-slate-500">
				<a href="/login" class="text-blue-600 hover:underline">Log in</a> to leave a comment.
			</p>
		{/if}
	</div>
</div>
