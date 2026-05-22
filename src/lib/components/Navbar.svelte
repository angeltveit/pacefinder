<script lang="ts">
	import { page } from '$app/state';

	let { user }: { user: { id: string; name: string; email: string; role: string } | null } =
		$props();

	let menuOpen = $state(false);

	const navLinks = [
		{ href: '/', label: 'Feed' },
		{ href: '/races', label: 'All Races' }
	];
</script>

<header class="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
	<nav class="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
		<!-- Logo -->
		<a href="/" class="flex items-center gap-2 text-lg font-bold text-blue-600">
			<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 10V3L4 14h7v7l9-11h-7z"
				/>
			</svg>
			RaceScout
		</a>

		<!-- Nav links -->
		<div class="hidden items-center gap-6 sm:flex">
			{#each navLinks as link}
				<a
					href={link.href}
					class="text-sm font-medium transition-colors {page.url.pathname === link.href
						? 'text-blue-600'
						: 'text-slate-600 hover:text-slate-900'}"
				>
					{link.label}
				</a>
			{/each}
			{#if user?.role === 'admin'}
				<a
					href="/admin"
					class="text-sm font-medium transition-colors {page.url.pathname.startsWith('/admin')
						? 'text-blue-600'
						: 'text-slate-600 hover:text-slate-900'}"
				>
					Admin
				</a>
			{/if}
		</div>

		<!-- User menu -->
		<div class="flex items-center gap-3">
			{#if user}
				<div class="relative">
					<button
						onclick={() => (menuOpen = !menuOpen)}
						class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
					>
						{user.name.charAt(0).toUpperCase()}
					</button>
					{#if menuOpen}
						<div
							class="absolute right-0 top-11 z-50 min-w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
						>
							<div class="border-b border-slate-100 px-4 py-2">
								<p class="text-sm font-medium text-slate-900">{user.name}</p>
								<p class="text-xs text-slate-500">{user.email}</p>
							</div>
							<a
								href="/profile"
								class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
								onclick={() => (menuOpen = false)}>Profile</a
							>
							{#if user.role === 'admin'}
								<a
									href="/admin"
									class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
									onclick={() => (menuOpen = false)}>Admin</a
								>
							{/if}
							<form method="POST" action="/auth/signout">
								<button
									type="submit"
									class="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
									onclick={() => (menuOpen = false)}>Sign out</button
								>
							</form>
						</div>
					{/if}
				</div>
			{:else}
				<a
					href="/login"
					class="text-sm font-medium text-slate-600 hover:text-slate-900"
				>Login</a
				>
				<a
					href="/register"
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
				>
					Sign up
				</a>
			{/if}
		</div>
	</nav>
</header>
