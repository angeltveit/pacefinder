<script lang="ts">
	interface Props {
		category: string;
	}
	let { category }: Props = $props();

	const map: Record<string, { label: string; cls: string }> = {
		local: { label: 'Local', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
		norway: { label: 'Norway', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
		international: { label: 'International', cls: 'bg-orange-50 text-orange-700 border-orange-200' }
	};

	const badge = $derived(map[category] ?? { label: category, cls: 'bg-slate-100 text-slate-600 border-slate-200' });
</script>

<span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide {badge.cls}">
	{badge.label}
</span>
