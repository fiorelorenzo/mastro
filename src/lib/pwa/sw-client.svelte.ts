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
import { invalidateAll } from '$app/navigation';
import {
	EMPTY_FRESHNESS_STATE,
	oldestStaleAt,
	recordRevalidated,
	recordSessionInvalid,
	recordStaleServe,
	shouldRefreshAfterFreshData,
	type FreshnessState
} from './freshness-policy';

interface ServiceWorkerMessage {
	readonly type: string;
	readonly url?: string;
	readonly cachedAt?: string | null;
	readonly changed?: boolean;
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
				// Read the decision before recording, since recording clears the
				// entry it depends on.
				//
				// Re-reading here closes two different gaps, either sufficient
				// on its own (#401): a stale serve followed by a fresh copy,
				// which used to take the banner down and leave the old rows on
				// screen, and a fresh copy that never got announced stale at
				// all because the revalidation both succeeded inside the
				// grace period AND returned different data — `message.changed`,
				// computed by the worker against the cache entry it just
				// replaced. What it must not do is re-read on every fresh
				// message unconditionally: a re-read refetches the same URL,
				// a successful refetch posts another `data-fresh`, and an
				// untouched tab never stopped (#340 — measured at about 30 a
				// second). That still holds here: the refetch this re-read
				// causes is diffed against the copy that write just produced,
				// so `changed` comes back false and nothing asks again.
				const refresh = shouldRefreshAfterFreshData(
					this.#entries,
					message.url,
					message.changed === true
				);
				this.#entries = recordRevalidated(this.#entries, message.url);
				if (refresh) void invalidateAll();
			} else if (message.type === 'mastro:data-written') {
				// A write emptied the cache (`dropDataCacheAfterWrite`). Every
				// tab re-reads, which is what makes a second tab agree with the
				// one the write happened in — and in the tab that did write, it
				// is what updates a sidebar count the mutated page's own load
				// never touches.
				this.#entries = EMPTY_FRESHNESS_STATE;
				void invalidateAll();
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
