<script lang="ts">
	interface Props {
		status: string;
	}
	let { status }: Props = $props();

	const map: Record<string, { label: string; cls: string }> = {
		open: { label: 'Registration open', cls: 'bg-green-50 text-green-700 border-green-200' },
		opening_soon: { label: 'Opening soon', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
		closed: { label: 'Registration closed', cls: 'bg-red-50 text-red-700 border-red-200' },
		unknown: { label: 'Registration unknown', cls: 'bg-slate-50 text-slate-500 border-slate-200' }
	};

	const badge = $derived(map[status] ?? map.unknown);
</script>

<span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium {badge.cls}">
	{badge.label}
</span>
