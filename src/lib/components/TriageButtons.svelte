<script lang="ts">
	interface Props {
		raceId: string;
		currentStatus: string | null;
	}

	let { raceId, currentStatus = $bindable() }: Props = $props();
	let loading = $state(false);

	const buttons = [
		{ status: 'interested', label: '❤️', title: 'Interested' },
		{ status: 'following', label: '🔔', title: 'Following' },
		{ status: 'seen', label: '✓', title: 'Seen' },
		{ status: 'skip', label: '✕', title: 'Skip' }
	];

	async function setStatus(status: string) {
		const newStatus = currentStatus === status ? null : status;
		loading = true;
		try {
			const res = await fetch(`/api/races/${raceId}/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});
			if (res.ok) currentStatus = newStatus;
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex items-center gap-1">
	{#each buttons as btn}
		<button
			title={btn.title}
			disabled={loading}
			onclick={() => setStatus(btn.status)}
			class="flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all
				{currentStatus === btn.status
					? 'bg-blue-600 text-white shadow-sm'
					: 'bg-slate-100 text-slate-500 hover:bg-slate-200'}
				disabled:opacity-50"
		>
			{btn.label}
		</button>
	{/each}
</div>
