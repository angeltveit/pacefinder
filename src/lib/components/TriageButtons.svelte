<script lang="ts">
	interface Props {
		raceId: string;
		currentStatus: string | null;
	}

	let { raceId, currentStatus = $bindable() }: Props = $props();
	let loading = $state(false);

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

<div class="flex items-center gap-2">
	<button
		onclick={() => setStatus('interested')}
		disabled={loading}
		class="flex-1 rounded-lg py-2 text-sm font-medium transition-all disabled:opacity-50
			{currentStatus === 'interested'
				? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
				: 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-slate-300'}"
	>
		{currentStatus === 'interested' ? '❤️' : '🤍'} Interested
	</button>
	<button
		onclick={() => setStatus('following')}
		disabled={loading}
		class="flex-1 rounded-lg py-2 text-sm font-medium transition-all disabled:opacity-50
			{currentStatus === 'following'
				? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
				: 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-slate-300'}"
	>
		{currentStatus === 'following' ? '🔔' : '🔕'} Track
	</button>
	<button
		onclick={() => setStatus('skip')}
		disabled={loading}
		class="rounded-lg px-3 py-2 text-sm transition-all disabled:opacity-50
			{currentStatus === 'skip'
				? 'text-slate-400'
				: 'text-slate-600 hover:text-slate-400 hover:bg-white/5'}"
		title="Not for me"
	>✕</button>
</div>
