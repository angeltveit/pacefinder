import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { incrStat, KEYS } from '$lib/server/redis';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(302, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const name = (data.get('name') as string)?.trim();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const password = data.get('password') as string;

		if (!name || !email || !password) return fail(400, { message: 'All fields are required' });
		if (password.length < 8) return fail(400, { message: 'Password must be at least 8 characters' });

		try {
			await auth.api.signUpEmail({ body: { name, email, password } });
			await incrStat(KEYS.USERS_TOTAL);
			await incrStat(KEYS.USERS_NEW_24H);
		} catch (err) {
			const msg = err instanceof Error ? err.message : '';
			if (msg.toLowerCase().includes('exist')) return fail(400, { message: 'Email already in use' });
			return fail(400, { message: 'Registration failed. Please try again.' });
		}

		redirect(302, '/');
	}
};
