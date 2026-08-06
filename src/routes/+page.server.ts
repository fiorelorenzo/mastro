import type { PageServerLoad } from './$types';

// / is protected by the default guard (src/hooks.server.ts), so locals.user
// is always set here: an unauthenticated request never reaches this load.
export const load: PageServerLoad = ({ locals }) => {
	return { user: locals.user! };
};
