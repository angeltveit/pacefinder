<script lang="ts">
	import './layout.css';
	import Navbar from '$lib/components/Navbar.svelte';

	let { children, data } = $props();
</script>

<svelte:head>
	<meta property="og:site_name" content="PaceFinder" />
	<meta property="og:image" content="{data.origin}/images/social.png" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content="{data.origin}/images/social.png" />
</svelte:head>

<div class="app-shell">
	<Navbar user={data?.user ?? null} />
	<main class="app-main">
		{@render children()}
	</main>
	<footer class="app-footer">
		<span>PaceFinder</span>
		<span class="dot">·</span>
		<span>Your race scout for the Nordics & beyond</span>
	</footer>
</div>

<style>
	.app-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.app-main {
		flex: 1;
		width: 100%;
		max-width: 1180px;
		margin: 0 auto;
		padding: 24px 20px 96px;
	}
	.app-footer {
		max-width: 1180px;
		margin: 0 auto;
		width: 100%;
		padding: 28px 20px 40px;
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 0.8rem;
		color: var(--text-faint);
		border-top: 1px solid var(--line);
	}
	.app-footer .dot {
		opacity: 0.5;
	}
	@media (max-width: 640px) {
		.app-main {
			padding: 16px 14px 90px;
		}
	}
</style>

