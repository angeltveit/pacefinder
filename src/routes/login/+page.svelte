<script lang="ts">
	import { enhance } from '$app/forms';

	let loading = $state(false);
	let error = $state('');
</script>

<svelte:head><title>Log in — PaceFinder</title></svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-3 text-3xl">⚡</div>
			<h1 class="text-2xl font-bold text-slate-100">Welcome back</h1>
			<p class="mt-1 text-sm text-slate-400">Log in to your PaceFinder account</p>
		</div>

		{#if error}
			<div class="mb-4 rounded-lg bg-red-950/60 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>
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
				<label for="email" class="block text-sm font-medium text-slate-300">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
					placeholder="you@example.com"
				/>
			</div>
			<div>
				<label for="password" class="block text-sm font-medium text-slate-300">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
					placeholder="••••••••"
				/>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{loading ? 'Logging in…' : 'Log in'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-slate-400">
			Don't have an account? <a href="/register" class="text-brand hover:underline">Sign up</a>
		</p>
	</div>
</div>
