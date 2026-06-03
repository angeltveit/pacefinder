import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	// Clear all better-auth session cookies.
	const cookieNames = [
		'better-auth.session_token',
		'better-auth.session_data',
		'better-auth.dont_remember',
		'better-auth-session'
	];
	for (const name of cookieNames) {
		cookies.delete(name, { path: '/' });
	}
	return json({ ok: true });
};
