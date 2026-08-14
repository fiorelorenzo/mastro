// The stateful half of Toast (#207): a page-wide singleton so any route or
// form action result can announce an outcome without threading a prop down
// through Page/layout, mirroring the install.svelte.ts / install-logic.ts
// split next to it in $lib/pwa. Decision logic (eviction, dismiss timing,
// politeness) lives in toast.ts and is unit tested there; this file is
// purely the setTimeout/id-generation wiring, deliberately untested here —
// this project's vitest project runs `node`, and the one thing this class
// adds over toast.ts's pure functions is real timers.
import { browser } from '$app/environment';
import {
	dismissToast,
	pushToast,
	resolveToastDuration,
	type ToastRecord,
	type ToastTone
} from './toast';

let nextId = 0;

class ToastStore {
	#toasts = $state<ToastRecord[]>([]);
	#timers = new Map<string, number>();

	get toasts(): readonly ToastRecord[] {
		return this.#toasts;
	}

	/** Announces `message`. `durationMs` follows `resolveToastDuration`:
	 *  omit it for the default auto-dismiss, pass `null` for a toast that
	 *  only leaves on a manual click. Returns the id, so a caller that
	 *  wants to dismiss it early (rare — most toasts are fire-and-forget) can. */
	push(tone: ToastTone, message: string, durationMs?: number | null): string {
		const id = `toast-${++nextId}`;
		this.#toasts = pushToast(this.#toasts, { id, tone, message });

		const duration = resolveToastDuration(durationMs);
		if (browser && duration !== null) {
			this.#timers.set(
				id,
				window.setTimeout(() => this.dismiss(id), duration)
			);
		}
		return id;
	}

	dismiss(id: string): void {
		this.#toasts = dismissToast(this.#toasts, id);
		const timer = this.#timers.get(id);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.#timers.delete(id);
		}
	}
}

export const toasts = new ToastStore();
