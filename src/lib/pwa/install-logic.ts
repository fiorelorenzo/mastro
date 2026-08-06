// Pure decision logic for the install affordance, kept apart from the DOM and
// localStorage wiring in install.svelte.ts so it can be unit tested without a
// browser environment.

export interface AndroidPromptInputs {
	/** The user has done something in this visit; not shown on first paint. */
	engaged: boolean;
	/** A `beforeinstallprompt` event has been captured and not yet consumed. */
	hasDeferredPrompt: boolean;
	/** The user dismissed the affordance, or the native prompt, on any past visit. */
	dismissed: boolean;
}

export function shouldShowAndroidPrompt({
	engaged,
	hasDeferredPrompt,
	dismissed
}: AndroidPromptInputs): boolean {
	return engaged && hasDeferredPrompt && !dismissed;
}

export interface IosHintInputs {
	engaged: boolean;
	isIos: boolean;
	isStandalone: boolean;
	/** The hint was already shown on a past visit; iOS gets no dismiss to wait for. */
	seenBefore: boolean;
	/** The hint was acknowledged during the current visit. */
	hiddenThisSession: boolean;
}

export function shouldShowIosHint({
	engaged,
	isIos,
	isStandalone,
	seenBefore,
	hiddenThisSession
}: IosHintInputs): boolean {
	// An installed app is already standalone: the hint would be telling the user
	// to do something they have already done.
	return engaged && isIos && !isStandalone && !seenBefore && !hiddenThisSession;
}
