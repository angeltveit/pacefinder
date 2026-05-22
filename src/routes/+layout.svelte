<script lang="ts">
	import './layout.css';
	import Navbar from '$lib/components/Navbar.svelte';

	let { children, data } = $props();
</script>

<div class="min-h-screen bg-slate-50 font-sans">
	<Navbar user={data?.user ?? null} />
	<main class="mx-auto max-w-3xl px-4 py-8">
		{@render children()}
	</main>
</div>

