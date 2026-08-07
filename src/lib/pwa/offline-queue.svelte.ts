// The DOM/IndexedDB/fetch side of the offline day queue (#62): decision
// logic lives in offline-queue.ts and is unit tested there without a
// browser, IndexedDB access lives in offline-queue-db.ts — the same split
// as freshness-policy.ts / sw-client.svelte.ts / sw-cache-policy.ts.
//
// Replaying a queued entry posts the exact same request use:enhance would
// have sent for a live submission — same URL, same headers, the same form
// fields — against the /day/new action, through the public deserialize()
// $app/forms already exports for exactly this: reading a fetch response
// the same way SvelteKit's own enhance() does internally. That is what
// "the offline queue and the server share one replay contract" means in
// practice: this store has no private notion of "did this day get
// recorded" that could diverge from what a normal online submission
// produces — see createWorkUnit (repositories/work-unit.ts) for the
// server half.
import { browser } from '$app/environment';
import { deserialize } from '$app/forms';
import { resolve } from '$app/paths';
import {
	classifyReplay,
	extractRejectionMessage,
	type QueuedDay,
	type QueuedDayStatus,
	type ReplayResult
} from './offline-queue';
import { deleteQueuedDay, loadQueuedDays, putQueuedDay } from './offline-queue-db';
import * as m from '$lib/paraglide/messages';

class OfflineQueueStore {
	#entries = $state<QueuedDay[]>([]);
	#replaying = false;

	get entries(): readonly QueuedDay[] {
		return this.#entries;
	}

	/** Loads whatever survived a reload or a closed tab, then replays once
	 * immediately — covers reopening the app already back online, not
	 * only the `online` event firing mid-session. Call once, from a
	 * component's `onMount`. */
	init(): () => void {
		if (!browser) return () => {};

		void loadQueuedDays().then((loaded) => {
			this.#entries = loaded;
			void this.replay();
		});

		const onOnline = () => void this.replay();
		window.addEventListener('online', onOnline);
		return () => window.removeEventListener('online', onOnline);
	}

	/**
	 * Queues a submission `use:enhance` could not reach the server with.
	 * `formData` must already carry the `workUnitId` field the day-entry
	 * form generates for every attempt — that value is both this entry's
	 * queue key and the `work_unit.id` the eventual insert uses (#62).
	 */
	async enqueue(formData: FormData): Promise<QueuedDay> {
		const id = String(formData.get('workUnitId') ?? '');
		if (!id) throw new Error('offline queue: form is missing workUnitId');

		const fields: Record<string, string> = {};
		for (const [key, value] of formData.entries()) {
			// The day-entry form has no <input type="file">, so every value is
			// a plain string; FormDataEntryValue's other case is File.
			if (typeof value === 'string') fields[key] = value;
		}

		const entry: QueuedDay = { id, queuedAt: new Date().toISOString(), fields, status: 'pending' };
		this.#entries = [...this.#entries, entry];
		await putQueuedDay(entry);
		void this.replay();
		return entry;
	}

	/** Removes a `failed` entry the user has acknowledged. Never called
	 * automatically: #62 asks for a rejection to surface, not to vanish on
	 * its own, so only the user dismisses one. */
	async dismiss(id: string): Promise<void> {
		this.#entries = this.#entries.filter((entry) => entry.id !== id);
		await deleteQueuedDay(id);
	}

	/** Attempts every entry that is not already `failed`, oldest first.
	 * Safe to call repeatedly (on `online`, after enqueueing, on mount):
	 * `#replaying` makes a call arriving mid-pass a no-op rather than a
	 * second, overlapping pass over the same entries. */
	async replay(): Promise<void> {
		if (!browser || this.#replaying) return;
		this.#replaying = true;
		try {
			const queuedInOrder = [...this.#entries].sort((a, b) =>
				a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0
			);
			for (const entry of queuedInOrder) {
				// A `failed` entry already got its answer from the server —
				// rejected, not unreachable — so trying it again would be
				// exactly the "retrying forever" #62 rules out.
				if (entry.status === 'failed') continue;
				await this.#replayOne(entry);
			}
		} finally {
			this.#replaying = false;
		}
	}

	async #replayOne(entry: QueuedDay): Promise<void> {
		await this.#setStatus(entry.id, 'syncing');

		const body = new FormData();
		for (const [key, value] of Object.entries(entry.fields)) body.set(key, value);

		let result: ReplayResult;
		try {
			const response = await fetch(resolve('/day/new'), {
				method: 'POST',
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
				body
			});
			const deserialized: ReplayResult = deserialize(await response.text());
			// Mirrors $app/forms's own enhance(): a response that came back
			// at all (however unhappy) carries a real HTTP status, which is
			// exactly what tells classifyReplay apart a server rejection
			// from fetch() never reaching the server in the first place.
			result =
				deserialized.type === 'error' && deserialized.status === undefined
					? { type: 'error', status: response.status, data: deserialized.data }
					: deserialized;
		} catch (error) {
			console.error(
				'offline queue: replay request for',
				entry.id,
				'did not reach the server',
				error
			);
			result = { type: 'error' };
		}

		const outcome = classifyReplay(result);
		if (outcome === 'synced') {
			this.#entries = this.#entries.filter((e) => e.id !== entry.id);
			await deleteQueuedDay(entry.id);
		} else if (outcome === 'rejected') {
			const message = extractRejectionMessage(result) ?? m.day_offline_sync_failed_generic();
			await this.#setStatus(entry.id, 'failed', message);
		} else {
			await this.#setStatus(entry.id, 'pending');
		}
	}

	async #setStatus(id: string, status: QueuedDayStatus, error?: string): Promise<void> {
		this.#entries = this.#entries.map((entry) =>
			entry.id === id ? { ...entry, status, error } : entry
		);
		const updated = this.#entries.find((entry) => entry.id === id);
		if (updated) await putQueuedDay(updated);
	}
}

export const offlineQueue = new OfflineQueueStore();
