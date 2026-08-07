// IndexedDB persistence for the offline day queue (#62), kept apart from
// the reactive/fetch wiring in offline-queue.svelte.ts the same way
// sw-cache-policy.ts's classification is kept apart from the Cache
// Storage calls in service-worker.ts. Browser-only: every export here
// assumes `indexedDB` exists, which offline-queue.svelte.ts guarantees by
// only calling in after checking `browser` from `$app/environment`.
//
// A dedicated database, not localStorage: a queued day can carry an
// arbitrary number of entries across an arbitrarily long offline stretch,
// and IndexedDB is what survives that without a synchronous, size-capped
// API blocking the main thread on every write.
import type { QueuedDay } from './offline-queue';

const DB_NAME = 'mastro-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queued-days';

function openDb(): Promise<IDBDatabase> {
	const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
	const request = indexedDB.open(DB_NAME, DB_VERSION);
	request.onupgradeneeded = () => {
		request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
	};
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error as Error);
	return promise;
}

/** Every entry still queued, in the order IndexedDB happens to store
 * them — callers that care about replay order (offline-queue.svelte.ts)
 * sort by `queuedAt` themselves rather than relying on this. */
export async function loadQueuedDays(): Promise<QueuedDay[]> {
	const db = await openDb();
	const { promise, resolve, reject } = Promise.withResolvers<QueuedDay[]>();
	const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
	request.onsuccess = () => {
		// IDBObjectStore.getAll() types its result `any[]` (lib.dom.d.ts has
		// no way to express "whatever was put in this store"); every write
		// goes through putQueuedDay below, which only ever stores a
		// QueuedDay, so this is the store's real, just unexpressed, type.
		const rows: QueuedDay[] = request.result;
		resolve(rows);
	};
	request.onerror = () => reject(request.error as Error);
	return promise;
}

/** Inserts or overwrites one entry, keyed by `entry.id` — the same
 * client-generated uuid the entry replays under. */
export async function putQueuedDay(entry: QueuedDay): Promise<void> {
	const db = await openDb();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	tx.objectStore(STORE_NAME).put(entry);
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error as Error);
	return promise;
}

/** Removes an entry once it has synced, or once the user dismisses a
 * `failed` one — see OfflineQueueStore in offline-queue.svelte.ts. */
export async function deleteQueuedDay(id: string): Promise<void> {
	const db = await openDb();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	tx.objectStore(STORE_NAME).delete(id);
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error as Error);
	return promise;
}
