<script lang="ts">
	let loading = $state(false);
	let error = $state('');
</script>

<svelte:head><title>Sign up — PaceFinder</title></svelte:head>

<div class="flex min-h-[70vh] items-center justify-center">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-3 text-3xl">⚡</div>
			<h1 class="text-2xl font-bold text-slate-100">Create account</h1>
			<p class="mt-1 text-sm text-slate-400">Join PaceFinder and track your races</p>
		</div>

		{#if error}
			<div class="mb-4 rounded-lg bg-red-950/60 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>
		{/if}

		<form
			method="POST"
			class="space-y-4"
			onsubmit={async (e) => {
				e.preventDefault();
				loading = true;
				error = '';
				const form = e.currentTarget as HTMLFormElement;
				const res = await fetch('/register', { method: 'POST', body: new FormData(form) });
				loading = false;
				if (res.redirected) window.location.href = res.url;
				else {
					try {
						const data = await res.json();
						// SvelteKit action responses wrap data in { type, data } or return raw
						const msg = data?.data?.message ?? data?.message ?? null;
						error = typeof msg === 'string' ? msg : 'Registration failed';
					} catch {
						error = 'Registration failed';
					}
				}
			}}
		>
			<div>
				<label for="name" class="block text-sm font-medium text-slate-300">Display name</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
					placeholder="Your name"
				/>
			</div>
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
					minlength="8"
					class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
					placeholder="At least 8 characters"
				/>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{loading ? 'Creating account…' : 'Create account'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-slate-400">
			Already have an account? <a href="/login" class="text-brand hover:underline">Log in</a>
		</p>
	</div>
</div>
