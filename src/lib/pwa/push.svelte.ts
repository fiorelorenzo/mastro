// The DOM/`fetch` half of push subscription (#63); `push-logic.ts` is the
// pure half. Mirrors `install.svelte.ts`'s split and its `browser` guard
// so this module is safe to import (though inert) during SSR.
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { isIosDevice, isRunningStandalone } from './install.svelte';
import { pushSupportStatus, type PushSupportStatus } from './push-logic';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

class PushSubscriptionStore {
	#subscribed = $state(false);
	#busy = $state(false);
	#permissionDenied = $state(false);
	#error = $state<string | null>(null);

	get status(): PushSupportStatus {
		if (!browser) return 'unsupported';
		return pushSupportStatus({
			hasServiceWorker: 'serviceWorker' in navigator,
			hasPushManager: 'PushManager' in window,
			hasNotification: 'Notification' in window,
			isIos: isIosDevice(),
			isStandalone: isRunningStandalone()
		});
	}

	get subscribed(): boolean {
		return this.#subscribed;
	}

	get busy(): boolean {
		return this.#busy;
	}

	get permissionDenied(): boolean {
		return this.#permissionDenied;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Reads whatever subscription already exists — call once, from the
	 * settings page's `onMount`, so "Enable"/"Disable" reflects reality
	 * even after a reload. */
	async init(): Promise<void> {
		if (!browser || this.status !== 'supported') return;
		const registration = await navigator.serviceWorker.ready;
		const existing = await registration.pushManager.getSubscription();
		this.#subscribed = existing !== null;
	}

	async subscribe(vapidPublicKey: string): Promise<void> {
		if (!browser || this.status !== 'supported') return;
		this.#busy = true;
		this.#error = null;
		this.#permissionDenied = false;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				this.#permissionDenied = true;
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
			});
			const json = subscription.toJSON();
			const response = await fetch(resolve('/api/push/subscribe'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
			});
			if (!response.ok) throw new Error(`subscribe request failed (${response.status})`);
			this.#subscribed = true;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#busy = false;
		}
	}

	/** Unsubscribes both sides: the browser's own subscription first (it
	 * alone knows the endpoint's push-service credentials), then the
	 * server row for that endpoint — #63's "unsubscribe respected
	 * server-side" is this second call, never skipped even if the first
	 * one already made the browser stop delivering. */
	async unsubscribe(): Promise<void> {
		if (!browser) return;
		this.#busy = true;
		this.#error = null;
		try {
			const registration = await navigator.serviceWorker.ready;
			const existing = await registration.pushManager.getSubscription();
			if (existing) {
				const endpoint = existing.endpoint;
				await existing.unsubscribe();
				await fetch(resolve('/api/push/unsubscribe'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ endpoint })
				});
			}
			this.#subscribed = false;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#busy = false;
		}
	}
}

export const pushSubscriptionStore = new PushSubscriptionStore();
