<script lang="ts">
	import { untrack } from 'svelte';
	let { data } = $props();
	let accounts = $state(untrack(() => data.accounts));
	let platform = $state<'instagram' | 'tiktok'>('instagram');
	let handle = $state('');
	let adding = $state(false);
	let error = $state('');

	const DEFAULT_ACCOUNTS = [
		{ platform: 'instagram', handle: 'vinloopet' },
		{ platform: 'instagram', handle: 'kondis.no' },
		{ platform: 'instagram', handle: 'bergenbymaraton' }
	];

	async function addAccount() {
		if (!handle.trim()) return;
		adding = true;
		error = '';
		try {
			const res = await fetch('/api/admin/social-accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ platform, handle: handle.trim().replace('@', '') })
			});
			if (res.ok) {
				const account = await res.json();
				accounts = [...accounts, account];
				handle = '';
			} else {
				const data = await res.json().catch(() => ({}));
				error = data.message ?? 'Failed to add account';
			}
		} finally {
			adding = false;
		}
	}

	async function deleteAccount(id: string) {
		const res = await fetch('/api/admin/social-accounts', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		if (res.ok) accounts = accounts.filter((a) => a.id !== id);
	}

	async function addDefault(acc: { platform: string; handle: string }) {
		const res = await fetch('/api/admin/social-accounts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(acc)
		});
		if (res.ok) {
			const account = await res.json();
			accounts = [...accounts, account];
		}
	}
</script>

<svelte:head><title>Social Accounts — Admin</title></svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-bold text-slate-900">Social Accounts to Monitor</h2>

	<!-- Default suggestions -->
	{#if accounts.length === 0}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
			<p class="text-sm font-medium text-slate-700 mb-3">Suggested starter accounts:</p>
			<div class="flex flex-wrap gap-2">
				{#each DEFAULT_ACCOUNTS as acc}
					<button
						onclick={() => addDefault(acc)}
						class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100"
					>
						+ @{acc.handle} ({acc.platform})
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Add form -->
	<div class="rounded-2xl border border-slate-200 bg-white p-5">
		<h3 class="mb-4 font-semibold text-slate-900">Add account</h3>
		{#if error}
			<p class="mb-3 text-sm text-red-600">{error}</p>
		{/if}
		<div class="flex flex-wrap gap-3">
			<select
				bind:value={platform}
				class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
			>
				<option value="instagram">Instagram</option>
				<option value="tiktok">TikTok</option>
			</select>
			<input
				bind:value={handle}
				placeholder="@handle"
				class="flex-1 min-w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
			/>
			<button
				onclick={addAccount}
				disabled={adding || !handle.trim()}
				class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
			>
				{adding ? 'Adding…' : 'Add'}
			</button>
		</div>
	</div>

	<!-- Account list -->
	{#if accounts.length === 0}
		<p class="text-sm text-slate-500">No accounts added yet.</p>
	{:else}
		<div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 border-b border-slate-200">
					<tr class="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
						<th class="px-4 py-3">Platform</th>
						<th class="px-4 py-3">Handle</th>
						<th class="px-4 py-3">Status</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each accounts as account}
						<tr class="hover:bg-slate-50">
							<td class="px-4 py-3">
								<span class="rounded-full px-2 py-0.5 text-xs font-medium
									{account.platform === 'instagram' ? 'bg-pink-50 text-pink-700' : 'bg-slate-100 text-slate-700'}">
									{account.platform}
								</span>
							</td>
							<td class="px-4 py-3 font-medium text-slate-900">@{account.handle}</td>
							<td class="px-4 py-3">
								<span class="rounded-full px-2 py-0.5 text-xs
									{account.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}">
									{account.active ? 'Active' : 'Paused'}
								</span>
							</td>
							<td class="px-4 py-3">
								<button
									onclick={() => deleteAccount(account.id)}
									class="text-xs text-red-500 hover:text-red-700 font-medium"
								>Remove</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
