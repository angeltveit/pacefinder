<script lang="ts">
	import { topoLines, hashString } from '$lib/theme';

	interface Props {
		seed: string;
		color: string;
		class?: string;
	}
	let { seed, color, class: cls = '' }: Props = $props();

	const lines = $derived(topoLines(seed, 7));
	const h = $derived(hashString(seed));
	// Two-stop gradient angle varies by seed for subtle variety
	const angle = $derived(20 + (h % 50));
</script>

<div
	class="topo {cls}"
	style="--c:{color}; background:
		radial-gradient(120% 120% at {15 + (h % 40)}% -10%, color-mix(in srgb, {color} 38%, transparent), transparent 60%),
		linear-gradient({angle}deg, #0f1626 0%, #0b1120 100%);"
>
	<svg viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
		{#each lines as d, i}
			<path
				{d}
				fill="none"
				stroke={color}
				stroke-width={i % 2 === 0 ? 1.4 : 0.9}
				stroke-opacity={0.10 + i * 0.025}
			/>
		{/each}
	</svg>
	<div class="grain"></div>
</div>

<style>
	.topo {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.topo svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.grain {
		position: absolute;
		inset: 0;
		background: radial-gradient(closest-side at 85% 20%, color-mix(in srgb, var(--c) 22%, transparent), transparent 70%);
		mix-blend-mode: screen;
		opacity: 0.5;
	}
</style>
