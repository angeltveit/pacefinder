<script lang="ts">
	import { page } from '$app/state';

	let { children, data } = $props();

	const links = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/social', label: 'Social Accounts' },
		{ href: '/admin/runs', label: 'Agent Runs' }
	];
</script>

{#if data.user?.role !== 'admin'}
	<div class="rounded-2xl border border-red-900/50 bg-red-900/20 p-8 text-center">
		<p class="font-medium text-red-400">Admin access required.</p>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Admin nav -->
		<div class="flex flex-wrap items-center gap-1 rounded-xl border border-slate-700/50 bg-slate-800/40 p-1">
			{#each links as link}
				<a
					href={link.href}
					class="rounded-lg px-4 py-2 text-sm font-medium transition-colors
						{page.url.pathname === link.href
							? 'bg-brand text-slate-900'
							: 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100'}"
				>
					{link.label}
				</a>
			{/each}
		</div>

		{@render children()}
	</div>
{/if}
