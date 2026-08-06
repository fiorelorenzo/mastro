import { describe, expect, it } from 'vitest';
import { shouldShowAndroidPrompt, shouldShowIosHint } from './install-logic';

describe('shouldShowAndroidPrompt', () => {
	it('stays hidden before the user has engaged, even with a captured prompt', () => {
		expect(
			shouldShowAndroidPrompt({ engaged: false, hasDeferredPrompt: true, dismissed: false })
		).toBe(false);
	});

	it('stays hidden without a captured beforeinstallprompt event', () => {
		expect(
			shouldShowAndroidPrompt({ engaged: true, hasDeferredPrompt: false, dismissed: false })
		).toBe(false);
	});

	it('shows once engaged with a captured prompt that has not been dismissed', () => {
		expect(
			shouldShowAndroidPrompt({ engaged: true, hasDeferredPrompt: true, dismissed: false })
		).toBe(true);
	});

	it('never shows again once dismissed', () => {
		expect(
			shouldShowAndroidPrompt({ engaged: true, hasDeferredPrompt: true, dismissed: true })
		).toBe(false);
	});
});

describe('shouldShowIosHint', () => {
	const engagedIosInBrowser = {
		engaged: true,
		isIos: true,
		isStandalone: false,
		seenBefore: false,
		hiddenThisSession: false
	};

	it('shows on iOS, in the browser tab, once engaged and never seen before', () => {
		expect(shouldShowIosHint(engagedIosInBrowser)).toBe(true);
	});

	it('stays hidden before engagement', () => {
		expect(shouldShowIosHint({ ...engagedIosInBrowser, engaged: false })).toBe(false);
	});

	it('stays hidden on non-iOS devices', () => {
		expect(shouldShowIosHint({ ...engagedIosInBrowser, isIos: false })).toBe(false);
	});

	it('stays hidden once the app already runs standalone', () => {
		expect(shouldShowIosHint({ ...engagedIosInBrowser, isStandalone: true })).toBe(false);
	});

	it('never shows again once it has been shown on a previous visit', () => {
		expect(shouldShowIosHint({ ...engagedIosInBrowser, seenBefore: true })).toBe(false);
	});

	it('hides immediately once acknowledged in the current session', () => {
		expect(shouldShowIosHint({ ...engagedIosInBrowser, hiddenThisSession: true })).toBe(false);
	});
});
