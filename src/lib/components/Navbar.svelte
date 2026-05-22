<script lang="ts">
	import { page } from '$app/state';

	let { user }: { user: { id: string; name: string; email: string; role: string } | null } =
		$props();

	let menuOpen = $state(false);
</script>

<header class="nav-header">
	<nav class="nav-inner">
		<!-- Logo -->
		<a href="/" class="logo">
			<span class="logo-icon">⚡</span>
			<span class="logo-text">PaceFinder</span>
		</a>

		<!-- Center nav -->
		<div class="nav-links">
			<a href="/" class="nav-link {page.url.pathname === '/' ? 'active' : ''}">Feed</a>
			<a href="/races" class="nav-link {page.url.pathname === '/races' ? 'active' : ''}">Browse</a>
			{#if user?.role === 'admin'}
				<a href="/admin" class="nav-link {page.url.pathname.startsWith('/admin') ? 'active' : ''}">Admin</a>
			{/if}
		</div>

		<!-- Right side -->
		<div class="nav-right">
			{#if user}
				<div class="avatar-wrap">
					<button class="avatar-btn" onclick={() => (menuOpen = !menuOpen)}>
						{user.name.charAt(0).toUpperCase()}
					</button>
					{#if menuOpen}
						<div class="dropdown">
							<div class="dropdown-header">
								<p class="dropdown-name">{user.name}</p>
								<p class="dropdown-email">{user.email}</p>
							</div>
							<a href="/profile" class="dropdown-item" onclick={() => (menuOpen = false)}>Profile</a>
							{#if user.role === 'admin'}
								<a href="/admin" class="dropdown-item" onclick={() => (menuOpen = false)}>Admin</a>
							{/if}
							<form method="POST" action="/auth/signout">
								<button type="submit" class="dropdown-item logout" onclick={() => (menuOpen = false)}>Sign out</button>
							</form>
						</div>
					{/if}
				</div>
			{:else}
				<a href="/login" class="login-link">Login</a>
				<a href="/register" class="signup-btn">Sign up</a>
			{/if}
		</div>
	</nav>
</header>

<style>
	.nav-header {
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(12px);
		background: rgba(12,15,26,0.9);
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.nav-inner {
		max-width: 32rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 6px;
		text-decoration: none;
	}
	.logo-icon { font-size: 1.4rem; }
	.logo-text {
		font-size: 1.1rem;
		font-weight: 800;
		color: #a3e635;
		letter-spacing: -0.02em;
	}

	.nav-links {
		display: flex;
		gap: 4px;
	}
	.nav-link {
		padding: 6px 14px;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #64748b;
		text-decoration: none;
		transition: all 0.15s;
	}
	.nav-link:hover { color: white; background: rgba(255,255,255,0.05); }
	.nav-link.active { color: white; background: rgba(255,255,255,0.08); }

	.nav-right { display: flex; align-items: center; gap: 10px; }

	.avatar-wrap { position: relative; }
	.avatar-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: rgba(163,230,53,0.15);
		border: 1.5px solid rgba(163,230,53,0.3);
		color: #a3e635;
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.avatar-btn:hover { background: rgba(163,230,53,0.25); }

	.dropdown {
		position: absolute;
		right: 0;
		top: 44px;
		min-width: 180px;
		background: #1e2238;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		padding: 4px;
		box-shadow: 0 16px 48px rgba(0,0,0,0.5);
	}
	.dropdown-header {
		padding: 10px 12px;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		margin-bottom: 4px;
	}
	.dropdown-name { font-size: 0.85rem; font-weight: 600; color: white; }
	.dropdown-email { font-size: 0.72rem; color: #64748b; }
	.dropdown-item {
		display: block;
		width: 100%;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 0.82rem;
		color: #94a3b8;
		text-decoration: none;
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
		transition: all 0.1s;
	}
	.dropdown-item:hover { background: rgba(255,255,255,0.05); color: white; }
	.dropdown-item.logout { color: #f87171; }
	.dropdown-item.logout:hover { background: rgba(239,68,68,0.1); }

	.login-link {
		font-size: 0.82rem;
		font-weight: 600;
		color: #94a3b8;
		text-decoration: none;
	}
	.login-link:hover { color: white; }
	.signup-btn {
		padding: 8px 16px;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 700;
		color: #0c0f1a;
		background: #a3e635;
		text-decoration: none;
		transition: background 0.15s;
	}
	.signup-btn:hover { background: #bef264; }
</style>
