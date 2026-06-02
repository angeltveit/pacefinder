<script lang="ts">
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	let { user }: { user: { id: string; name: string; email: string; role: string } | null } =
		$props();

	let menuOpen = $state(false);

	const links = $derived(
		[
			{ href: '/', label: 'For You', match: (p: string) => p === '/', show: true },
			{
				href: '/followed',
				label: 'Followed races',
				match: (p: string) => p.startsWith('/followed'),
				show: !!user
			},
			{ href: '/races', label: 'Explore', match: (p: string) => p.startsWith('/races'), show: true }
		].filter((l) => l.show)
	);
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<header class="nav-header">
	<nav class="nav-inner">
		<a href="/" class="logo">
			<span class="logo-mark"><Icon name="zap" size={16} fill /></span>
			<span class="logo-text">PaceFinder</span>
		</a>

		<div class="nav-links">
			{#each links as l}
				<a href={l.href} class="nav-link {l.match(page.url.pathname) ? 'active' : ''}">{l.label}</a>
			{/each}
			{#if user?.role === 'admin'}
				<a href="/admin" class="nav-link {page.url.pathname.startsWith('/admin') ? 'active' : ''}"
					>Admin</a
				>
			{/if}
		</div>

		<div class="nav-right">
			{#if user}
				<div class="avatar-wrap">
					<button
						class="avatar-btn"
						onclick={(e) => {
							e.stopPropagation();
							menuOpen = !menuOpen;
						}}
						aria-label="Account menu"
					>
						{user.name.charAt(0).toUpperCase()}
					</button>
					{#if menuOpen}
						<div class="dropdown" role="menu">
							<div class="dropdown-header">
								<p class="dropdown-name">{user.name}</p>
								<p class="dropdown-email">{user.email}</p>
							</div>
							<a href="/profile" class="dropdown-item">Profile &amp; preferences</a>
							{#if user.role === 'admin'}
								<a href="/admin" class="dropdown-item">Admin</a>
							{/if}
							<form method="POST" action="/auth/signout">
								<button type="submit" class="dropdown-item logout">Sign out</button>
							</form>
						</div>
					{/if}
				</div>
			{:else}
				<a href="/login" class="login-link">Log in</a>
				<a href="/register" class="signup-btn">Get started</a>
			{/if}
		</div>
	</nav>
</header>

<style>
	.nav-header {
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(16px) saturate(140%);
		background: rgba(10, 14, 23, 0.72);
		border-bottom: 1px solid var(--line);
	}
	.nav-inner {
		max-width: 1180px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 20px;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 9px;
		text-decoration: none;
	}
	.logo-mark {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		color: #0a0e17;
		background: linear-gradient(135deg, var(--color-brand-bright), var(--color-brand-dim));
		box-shadow: 0 4px 14px rgba(196, 240, 66, 0.35);
	}
	.logo-text {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text-strong);
		letter-spacing: -0.02em;
	}

	.nav-links {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--line);
		padding: 4px;
		border-radius: 12px;
	}
	.nav-link {
		padding: 7px 16px;
		border-radius: 9px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		transition: all 0.15s var(--ease-out);
	}
	.nav-link:hover {
		color: var(--text-strong);
	}
	.nav-link.active {
		color: #0a0e17;
		background: var(--color-brand);
	}

	.nav-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.avatar-wrap {
		position: relative;
	}
	.avatar-btn {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: rgba(196, 240, 66, 0.14);
		border: 1.5px solid rgba(196, 240, 66, 0.3);
		color: var(--color-brand-bright);
		font-weight: 700;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.15s var(--ease-out);
	}
	.avatar-btn:hover {
		background: rgba(196, 240, 66, 0.24);
		transform: translateY(-1px);
	}

	.dropdown {
		position: absolute;
		right: 0;
		top: 48px;
		min-width: 210px;
		background: var(--color-surface-2);
		border: 1px solid var(--line-strong);
		border-radius: 16px;
		padding: 6px;
		box-shadow: var(--shadow-lg);
		animation: pf-rise 0.16s var(--ease-out) both;
	}
	.dropdown-header {
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
		margin-bottom: 4px;
	}
	.dropdown-name {
		font-size: 0.88rem;
		font-weight: 700;
		color: var(--text-strong);
	}
	.dropdown-email {
		font-size: 0.74rem;
		color: var(--text-faint);
	}
	.dropdown-item {
		display: block;
		width: 100%;
		padding: 9px 12px;
		border-radius: 10px;
		font-size: 0.85rem;
		color: var(--text);
		text-decoration: none;
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
		transition: all 0.1s;
	}
	.dropdown-item:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-strong);
	}
	.dropdown-item.logout {
		color: #f87171;
	}
	.dropdown-item.logout:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.login-link {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		padding: 8px 10px;
	}
	.login-link:hover {
		color: var(--text-strong);
	}
	.signup-btn {
		padding: 9px 18px;
		border-radius: 11px;
		font-size: 0.85rem;
		font-weight: 700;
		color: #0a0e17;
		background: var(--color-brand);
		text-decoration: none;
		transition: all 0.15s var(--ease-out);
		box-shadow: 0 4px 16px rgba(196, 240, 66, 0.25);
	}
	.signup-btn:hover {
		background: var(--color-brand-bright);
		transform: translateY(-1px);
	}

	@media (max-width: 520px) {
		.logo-text {
			display: none;
		}
		.nav-link {
			padding: 7px 12px;
		}
	}
</style>
