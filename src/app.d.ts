// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: {
				id: string;
				name: string;
				email: string;
				role: string;
				city: string | null;
				country: string | null;
				isBlocked: boolean;
			};
			session?: import('better-auth/minimal').Session;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
