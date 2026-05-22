<script lang="ts">
	let loading = $state(false);
	let error = $state('');
</script>

<svelte:head><title>Sign up — RaceScout</title></svelte:head>

<div class="flex min-h-[70vh] items-center justify-center">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-bold text-slate-900">Create account</h1>
			<p class="mt-1 text-sm text-slate-500">Join RaceScout and track your races</p>
		</div>

		{#if error}
			<div class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
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
					const data = await res.json().catch(() => ({}));
					error = data.message ?? 'Registration failed';
				}
			}}
		>
			<div>
				<label for="name" class="block text-sm font-medium text-slate-700">Display name</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
					placeholder="Your name"
				/>
			</div>
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
					minlength="8"
					class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
					placeholder="At least 8 characters"
				/>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
			>
				{loading ? 'Creating account…' : 'Create account'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-slate-500">
			Already have an account? <a href="/login" class="text-blue-600 hover:underline">Log in</a>
		</p>
	</div>
</div>
