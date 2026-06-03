import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

// Redirect GET requests (e.g. user lands here directly) to home.
export const load: PageServerLoad = async () => {
	redirect(302, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		try {
			await auth.api.signOut({ headers: request.headers });
		} catch {
			// Session may already be gone — continue to clear cookies anyway.
		}
		// Force-clear the session cookie via the SvelteKit cookies API so the
		// browser definitely sends no session on the next request.
		cookies.delete('better-auth-session', { path: '/' });
		redirect(302, '/login');
	}
};
