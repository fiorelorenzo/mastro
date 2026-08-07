// The page-side half of the service worker (#61): listens for the
// freshness messages src/service-worker.ts posts to every open tab, and
// reloads once when a new worker takes over. Registration itself needs no
// code here — SvelteKit injects it automatically (`kit.serviceWorker.register`
// defaults to `true`) whenever src/service-worker.ts exists.
//
// Decision logic lives in freshness-policy.ts and is unit tested there;
// this file is purely DOM/Svelte wiring, mirroring the install.svelte.ts /
// install-logic.ts split next to it.
import { browser } from '$app/environment';
import {
	EMPTY_FRESHNESS_STATE,
	oldestStaleAt,
	recordRevalidated,
	recordSessionInvalid,
	recordStaleServe,
	type FreshnessState
} from './freshness-policy';

interface ServiceWorkerMessage {
	readonly type: string;
	readonly url?: string;
	readonly cachedAt?: string | null;
}

function isServiceWorkerMessage(data: unknown): data is ServiceWorkerMessage {
	return (
		typeof data === 'object' && data !== null && 'type' in data && typeof data.type === 'string'
	);
}

class ServiceWorkerClient {
	#entries = $state<FreshnessState>(EMPTY_FRESHNESS_STATE);
	#online = $state(browser ? navigator.onLine : true);

	/** The oldest still-stale cache timestamp currently on screen, or `null` if nothing shown came from the cache. */
	get oldestStaleAt(): string | null {
		return oldestStaleAt(this.#entries);
	}

	get offline(): boolean {
		return !this.#online;
	}

	/** Wires the browser listeners. Call once, from a component's `onMount`. */
	init(): () => void {
		if (!browser || !('serviceWorker' in navigator)) return () => {};

		const onMessage = (event: MessageEvent) => {
			if (!isServiceWorkerMessage(event.data)) return;
			const message = event.data;
			if (message.type === 'mastro:data-stale' && message.url) {
				this.#entries = recordStaleServe(
					this.#entries,
					message.url,
					message.cachedAt ?? new Date().toISOString()
				);
			} else if (message.type === 'mastro:data-fresh' && message.url) {
				this.#entries = recordRevalidated(this.#entries, message.url);
			} else if (message.type === 'mastro:session-invalid') {
				this.#entries = recordSessionInvalid();
			}
		};

		const onOnline = () => {
			this.#online = true;
		};
		const onOffline = () => {
			this.#online = false;
		};

		// A new service worker only ever calls `clients.claim()` after
		// `skipWaiting()` (src/service-worker.ts's `activate`), which is
		// exactly the deploy-takes-effect requirement in #61: reload once,
		// guarded so the redundant `controllerchange` a browser can fire
		// right after `register()` never loops.
		let reloaded = false;
		const onControllerChange = () => {
			if (reloaded) return;
			reloaded = true;
			location.reload();
		};

		navigator.serviceWorker.addEventListener('message', onMessage);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

		return () => {
			navigator.serviceWorker.removeEventListener('message', onMessage);
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	}
}

export const swClient = new ServiceWorkerClient();
