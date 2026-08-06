// The one file that changes when a pack is added. `pack.ts` and
// `resolve.ts` — the engine — import nothing from `packs/`, so a new pack
// is a new file here plus one line below, never a change to how resolution
// or charge evaluation works.

import type { FiscalPack } from './pack';
import { genericPack } from './packs/generic';
import { itFlatRatePack } from './packs/it-flat-rate';

export type PackRegistry = ReadonlyMap<string, FiscalPack>;

function packKey(id: string, version: string): string {
	return `${id}@${version}`;
}

export function buildRegistry(packs: readonly FiscalPack[]): PackRegistry {
	const registry = new Map<string, FiscalPack>();
	for (const pack of packs) {
		const key = packKey(pack.id, pack.version);
		if (registry.has(key)) throw new Error(`duplicate pack registration: ${key}`);
		registry.set(key, pack);
	}
	return registry;
}

/** Looks up a pack by the id and version a `fiscal_profile` row names.
 * Throws rather than falling back: a profile pointing at an unregistered
 * pack is a deployment error, not something to paper over. */
export function lookupPack(registry: PackRegistry, id: string, version: string): FiscalPack {
	const pack = registry.get(packKey(id, version));
	if (!pack) throw new Error(`no pack registered for ${packKey(id, version)}`);
	return pack;
}

/** Every pack mastro ships, registered once. */
export const defaultRegistry: PackRegistry = buildRegistry([genericPack, itFlatRatePack]);
