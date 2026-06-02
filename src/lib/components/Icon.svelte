<script lang="ts">
	/**
	 * Lightweight inline-SVG icon set (Lucide-derived paths).
	 * Replaces emoji-as-UI with crisp, consistent iconography.
	 */
	interface Props {
		name: keyof typeof PATHS;
		size?: number;
		stroke?: number;
		class?: string;
		fill?: boolean;
	}
	let { name, size = 18, stroke = 2, class: cls = '', fill = false }: Props = $props();

	const PATHS = {
		'map-pin': '<path d="M20 10c0 4.4-8 12-8 12s-8-7.6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
		calendar:
			'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		medal:
			'<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
		trophy:
			'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
		heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
		flame:
			'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
		zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
		plane:
			'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
		mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
		search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
		'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
		sparkles:
			'<path d="M9.94 14.66A1 1 0 0 1 9 14a1 1 0 0 1-.94-.66L7.07 10.3a1 1 0 0 0-.62-.62L3.4 8.94A1 1 0 0 1 3.4 7.06l3.05-.74a1 1 0 0 0 .62-.62l.99-3.04a1 1 0 0 1 1.88 0l.99 3.04a1 1 0 0 0 .62.62l3.05.74a1 1 0 0 1 0 1.88l-3.05.74a1 1 0 0 0-.62.62Z"/><path d="M18 6h.01M20 16h.01"/>',
		'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
		'external': '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
		'chevron-right': '<path d="m9 18 6-6-6-6"/>',
		check: '<path d="M20 6 9 17l-5-5"/>',
		users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
		message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
		bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
		route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
		menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
		ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
		package: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12M7.5 4.27l9 5.15"/>',
		utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
		info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
		x: '<path d="M18 6 6 18M6 6l12 12"/>'
	} as const;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={fill ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html PATHS[name]}
</svg>
