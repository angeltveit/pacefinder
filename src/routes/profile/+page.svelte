<script lang="ts">
	import CategoryBadge from '$lib/components/CategoryBadge.svelte';
	import MedalBadge from '$lib/components/MedalBadge.svelte';

	let { data } = $props();

	const statusGroups = ['interested', 'following', 'seen', 'skip'] as const;
	const statusLabels: Record<string, string> = {
		interested: '❤️ Interested',
		following: '🔔 Following',
		seen: '✓ Seen',
		skip: '✕ Skipped'
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

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">My Races</h1>
		<p class="mt-1 text-sm text-slate-500">
			{data.triaged.length} races triaged
		</p>
	</div>

	{#if data.triaged.length === 0}
		<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
			<p class="text-slate-500">You haven't triaged any races yet.</p>
			<a href="/races" class="mt-4 inline-block text-sm text-blue-600 hover:underline">Browse races →</a>
		</div>
	{:else}
		{#each statusGroups as status}
			{#if grouped(status).length > 0}
				<div>
					<h2 class="mb-3 text-base font-semibold text-slate-900">{statusLabels[status]}</h2>
					<div class="space-y-3">
						{#each grouped(status) as item}
							<a
								href="/races/{item.race.id}"
								class="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow"
							>
								<div class="min-w-0">
									<p class="font-medium text-slate-900 truncate">{item.race.name}</p>
									<div class="mt-1 flex flex-wrap items-center gap-2">
										<CategoryBadge category={item.race.category} />
										<MedalBadge status={item.race.medalStatus} />
										{#if item.race.raceDate}
											<span class="text-xs text-slate-500">{formatDate(item.race.raceDate)}</span>
										{/if}
									</div>
									{#if item.notes}
										<p class="mt-1 text-xs text-slate-500 italic">{item.notes}</p>
									{/if}
								</div>
								<span class="text-xs text-slate-400 whitespace-nowrap shrink-0">
									{formatDate(item.updatedAt)}
								</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	{/if}
</div>
