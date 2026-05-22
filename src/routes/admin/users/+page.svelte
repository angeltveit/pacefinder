<script lang="ts">
	import { untrack } from 'svelte';
	let { data } = $props();
	let users = $state(untrack(() => data.users));

	async function toggleBlock(userId: string, blocked: boolean) {
		const res = await fetch(`/api/admin/users/${userId}/block`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ blocked })
		});
		if (res.ok) {
			users = users.map((u) => (u.id === userId ? { ...u, isBlocked: blocked } : u));
		}
	}
</script>

<svelte:head><title>Users — Admin</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-bold text-slate-900">Users ({data.users.length})</h2>

	<div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-slate-50 border-b border-slate-200">
				<tr class="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
					<th class="px-4 py-3">Name</th>
					<th class="px-4 py-3">Email</th>
					<th class="px-4 py-3">Role</th>
					<th class="px-4 py-3">Joined</th>
					<th class="px-4 py-3">Status</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each users as u}
					<tr class="hover:bg-slate-50">
						<td class="px-4 py-3 font-medium text-slate-900">{u.name}</td>
						<td class="px-4 py-3 text-slate-600">{u.email}</td>
						<td class="px-4 py-3">
							<span class="rounded-full px-2 py-0.5 text-xs font-medium
								{u.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}">
								{u.role}
							</span>
						</td>
						<td class="px-4 py-3 text-slate-500 whitespace-nowrap">
							{new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
						</td>
						<td class="px-4 py-3">
							{#if u.isBlocked}
								<span class="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs text-red-700">Blocked</span>
							{:else}
								<span class="rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs text-green-700">Active</span>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if u.role !== 'admin'}
								{#if u.isBlocked}
									<button
										onclick={() => toggleBlock(u.id, false)}
										class="text-xs text-blue-600 hover:text-blue-800 font-medium"
									>Unblock</button>
								{:else}
									<button
										onclick={() => toggleBlock(u.id, true)}
										class="text-xs text-red-600 hover:text-red-800 font-medium"
									>Block</button>
								{/if}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
