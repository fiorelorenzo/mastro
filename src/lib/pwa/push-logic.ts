// Pure decision logic for the push settings screen (#63), kept apart from
// the DOM/`fetch` wiring in `push.svelte.ts` — the same split
// `install-logic.ts`/`install.svelte.ts` establishes for the install
// affordance.

export type PushSupportStatus = 'unsupported' | 'ios-needs-install' | 'supported';

export interface PushSupportInputs {
	readonly hasServiceWorker: boolean;
	readonly hasPushManager: boolean;
	readonly hasNotification: boolean;
	readonly isIos: boolean;
	readonly isStandalone: boolean;
}

/**
 * Whether this browser can subscribe to push right now, and why not when
 * it cannot. `'ios-needs-install'` is the whole point of #63's onboarding
 * bullet: iOS Safari exposes `PushManager` even before the page is
 * installed to the home screen, but `subscribe()` only succeeds once it
 * is — so this is checked *ahead of* the API call from data the settings
 * page already has (`isIosDevice`/`isRunningStandalone`,
 * `install.svelte.ts`), not discovered from a failed `subscribe()` a user
 * has already tapped "Enable" to trigger.
 */
export function pushSupportStatus(inputs: PushSupportInputs): PushSupportStatus {
	if (!inputs.hasServiceWorker || !inputs.hasPushManager || !inputs.hasNotification) {
		return 'unsupported';
	}
	if (inputs.isIos && !inputs.isStandalone) return 'ios-needs-install';
	return 'supported';
}
