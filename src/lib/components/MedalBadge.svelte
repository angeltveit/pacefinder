<script lang="ts">
	interface Props {
		status: string;
	}
	let { status }: Props = $props();

	const map: Record<string, { label: string; cls: string }> = {
		confirmed: { label: '🏅 Medal confirmed', cls: 'bg-green-50 text-green-700 border-green-200' },
		likely: { label: '🥈 Medal likely', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		unclear: { label: 'Medal unclear', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
	};

	const badge = $derived(map[status] ?? map.unclear);
</script>

<span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium {badge.cls}">
	{badge.label}
</span>
