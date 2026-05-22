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
	<div class="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
		<p class="text-red-700 font-medium">Admin access required.</p>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Admin nav -->
		<div class="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
			{#each links as link}
				<a
					href={link.href}
					class="rounded-lg px-4 py-2 text-sm font-medium transition-colors
						{page.url.pathname === link.href
							? 'bg-blue-600 text-white'
							: 'text-slate-600 hover:bg-slate-100'}"
				>
					{link.label}
				</a>
			{/each}
		</div>

		{@render children()}
	</div>
{/if}
