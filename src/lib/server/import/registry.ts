// The one file that changes when a format adapter is added. `adapter.ts`
// and `importer.ts` — the engine — import nothing from `formats/`, so a
// new adapter is a new file here plus one line below, never a change to
// how resolution works. Mirrors `fiscal/registry.ts`.

import type { InvoiceFormatAdapter } from './adapter';
import { fatturaPaAdapter } from './formats/fattura-pa/adapter';

export type AdapterRegistry = ReadonlyMap<string, InvoiceFormatAdapter>;

export function buildAdapterRegistry(adapters: readonly InvoiceFormatAdapter[]): AdapterRegistry {
	const registry = new Map<string, InvoiceFormatAdapter>();
	for (const adapter of adapters) {
		if (registry.has(adapter.id)) {
			throw new Error(`duplicate adapter registration: ${adapter.id}`);
		}
		registry.set(adapter.id, adapter);
	}
	return registry;
}

/** Every adapter mastro ships, registered once. */
export const defaultAdapterRegistry: AdapterRegistry = buildAdapterRegistry([fatturaPaAdapter]);
