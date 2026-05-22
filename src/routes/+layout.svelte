<script lang="ts">
	import './layout.css';
	import Navbar from '$lib/components/Navbar.svelte';

	let { children, data } = $props();
</script>

<div class="min-h-screen font-sans" style="background:#0c0f1a;">
	<Navbar user={data?.user ?? null} />
	<main class="mx-auto max-w-lg px-4 pb-24 pt-6">
		{@render children()}
	</main>
</div>

