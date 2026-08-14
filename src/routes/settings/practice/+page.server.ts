// #258: the practice's own fiscal identity, configured from the
// interface. Reachable from `/settings`'s own summary row (owned by
// W6Health — see `settings_practice_manage_link` there); this is the page
// that actually reads and writes `practice_profile`.

import { fail, redirect } from '@sveltejs/kit';
import { settingsCrumbs } from '$lib/nav/crumbs';
import { getPracticeProfile, savePracticeProfile } from '$lib/server/repositories/practice-profile';
import { parsePracticeProfileForm } from '$lib/server/repositories/practice-profile-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const profile = await getPracticeProfile();
	return {
		// `null` on a fresh instance — no `practice_profile` row yet. The
		// page renders a visible "not configured" banner for this case
		// rather than a form that merely looks blank.
		profile: profile ?? null,
		crumbs: settingsCrumbs()
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const result = parsePracticeProfileForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await savePracticeProfile(result.input);

		redirect(303, '/settings/practice');
	}
};
