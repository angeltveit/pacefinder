<script lang="ts">
	import { enhance } from '$app/forms';

	let loading = $state(false);
	let error = $state('');
</script>

<svelte:head><title>Log in — PaceFinder</title></svelte:head>

<div class="flex min-h-[70vh] items-center justify-center">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-bold text-slate-900">Welcome back</h1>
			<p class="mt-1 text-sm text-slate-500">Log in to your RaceScout account</p>
		</div>

		{#if error}
			<div class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
		{/if}

		<form
			method="POST"
			class="space-y-4"
			use:enhance={({ formData }) => {
				loading = true;
				error = '';
				return async ({ result, update }) => {
					loading = false;
					if (result.type === 'failure') error = String(result.data?.message ?? 'Login failed');
					else update();
				};
			}}
		>
			<div>
				<label for="email" class="block text-sm font-medium text-slate-700">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
					placeholder="you@example.com"
				/>
			</div>
			<div>
				<label for="password" class="block text-sm font-medium text-slate-700">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
					placeholder="••••••••"
				/>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
			>
				{loading ? 'Logging in…' : 'Log in'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-slate-500">
			Don't have an account? <a href="/register" class="text-blue-600 hover:underline">Sign up</a>
		</p>
	</div>
</div>
