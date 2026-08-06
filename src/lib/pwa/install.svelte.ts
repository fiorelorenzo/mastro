// Wires the DOM/localStorage side of the install affordance; the show/hide
// decisions themselves live in install-logic.ts so they can be unit tested
// without a browser.
import { browser } from '$app/environment';
import { shouldShowAndroidPrompt, shouldShowIosHint } from './install-logic';

const ANDROID_DISMISSED_KEY = 'mastro:install-prompt-dismissed';
const IOS_HINT_SEEN_KEY = 'mastro:ios-install-hint-seen';
// Not on first paint: wait for the user to do something, or this long, whichever
// comes first, before showing any install affordance.
const ENGAGEMENT_DELAY_MS = 20_000;
const ENGAGEMENT_EVENTS = ['pointerdown', 'keydown', 'scroll'] as const;

/** Chrome/Edge fire this instead of a plain Event; not yet in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** iOS Safari-only; not in lib.dom.d.ts either. */
type IosNavigator = Navigator & { standalone?: boolean };

function writeFlag(key: string): void {
	if (browser) localStorage.setItem(key, 'true');
}

function isIosDevice(): boolean {
	// The `standalone` property only ever exists on iOS Safari's navigator; unlike
	// user-agent sniffing it is not spoofed by a desktop-site toggle.
	return browser && 'standalone' in navigator;
}

function isRunningStandalone(): boolean {
	if (!browser) return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as IosNavigator).standalone === true
	);
}

class InstallPromptStore {
	#engaged = $state(false);
	#deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	#androidDismissed = $state(browser && localStorage.getItem(ANDROID_DISMISSED_KEY) === 'true');
	#iosHintSeenBefore = $state(browser && localStorage.getItem(IOS_HINT_SEEN_KEY) === 'true');
	#iosHintHiddenNow = $state(false);

	get showAndroidPrompt(): boolean {
		return shouldShowAndroidPrompt({
			engaged: this.#engaged,
			hasDeferredPrompt: this.#deferredPrompt !== null,
			dismissed: this.#androidDismissed
		});
	}

	get showIosHint(): boolean {
		return shouldShowIosHint({
			engaged: this.#engaged,
			isIos: isIosDevice(),
			isStandalone: isRunningStandalone(),
			seenBefore: this.#iosHintSeenBefore,
			hiddenThisSession: this.#iosHintHiddenNow
		});
	}

	/** Wires the browser listeners. Call once, from a component's `onMount`. */
	init(): () => void {
		if (!browser || isRunningStandalone()) return () => {};

		const onBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			this.#deferredPrompt = event as BeforeInstallPromptEvent;
		};
		const onInstalled = () => {
			this.#deferredPrompt = null;
			this.#androidDismissed = true;
		};
		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		window.addEventListener('appinstalled', onInstalled);

		const markEngaged = () => {
			if (this.#engaged) return;
			this.#engaged = true;
			// The iOS hint has no dismiss event to wait for, so being shown once,
			// right now, is what "once" means for it: record it immediately.
			if (isIosDevice() && !isRunningStandalone() && !this.#iosHintSeenBefore) {
				writeFlag(IOS_HINT_SEEN_KEY);
			}
			clearEngagementListeners();
		};
		const timer = window.setTimeout(markEngaged, ENGAGEMENT_DELAY_MS);
		for (const type of ENGAGEMENT_EVENTS) {
			window.addEventListener(type, markEngaged, { once: true, passive: true });
		}
		function clearEngagementListeners() {
			window.clearTimeout(timer);
			for (const type of ENGAGEMENT_EVENTS) window.removeEventListener(type, markEngaged);
		}

		return () => {
			window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
			window.removeEventListener('appinstalled', onInstalled);
			clearEngagementListeners();
		};
	}

	async promptInstall(): Promise<void> {
		const prompt = this.#deferredPrompt;
		if (!prompt) return;
		this.#deferredPrompt = null;
		await prompt.prompt();
		const { outcome } = await prompt.userChoice;
		if (outcome === 'dismissed') this.dismissAndroid();
	}

	dismissAndroid(): void {
		this.#androidDismissed = true;
		writeFlag(ANDROID_DISMISSED_KEY);
	}

	hideIosHint(): void {
		this.#iosHintHiddenNow = true;
		writeFlag(IOS_HINT_SEEN_KEY);
	}
}

export const installPrompt = new InstallPromptStore();
