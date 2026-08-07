import type { Crumb } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { ALERT_TYPES } from '$lib/server/db/schema/alert';
import { vapidPublicKeyFromEnv } from '$lib/server/push/config';
import { listSubscriptions } from '$lib/server/push/repository';
import {
	DEFAULT_PREFERENCE,
	listAlertPreferences,
	setAlertPreference
} from '$lib/server/alerts/state';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const preferences = await listAlertPreferences();
	const subscriptions = await listSubscriptions();

	let vapidPublicKey: string | null;
	try {
		vapidPublicKey = vapidPublicKeyFromEnv();
	} catch {
		// Unconfigured is a supported state (#63's "an instance the
		// self-hoster has not generated VAPID keys for yet"), never a crash
		// — the page shows "push is not configured here" instead.
		vapidPublicKey = null;
	}

	const crumbs: Crumb[] = [{ href: '/alerts', label: m.nav_alerts() }];
	return {
		preferences: ALERT_TYPES.map((type) => ({
			type,
			...(preferences.get(type) ?? DEFAULT_PREFERENCE)
		})),
		vapidPublicKey,
		subscriptionCount: subscriptions.length,
		crumbs
	};
};

export const actions: Actions = {
	savePreferences: async ({ request }) => {
		const formData = await request.formData();
		await Promise.all(
			ALERT_TYPES.map((type) =>
				setAlertPreference(type, {
					digestEnabled: formData.get(`digest_${type}`) === 'on',
					pushEnabled: formData.get(`push_${type}`) === 'on'
				})
			)
		);
		return { saved: true };
	}
};
