// The one file that changes when a generator is added. `generator.ts` and
// `generate.ts` — the engine — import nothing from `formats/`, so a new
// generator is a new file here plus one line below, never a change to how
// resolution works. Mirrors `import/registry.ts`.

import type { InvoiceFormatGenerator } from './generator';
import { itFatturaPaGenerator } from './formats/it-fattura-pa/generator';

export type GeneratorRegistry = ReadonlyMap<string, InvoiceFormatGenerator>;

export function buildGeneratorRegistry(
	generators: readonly InvoiceFormatGenerator[]
): GeneratorRegistry {
	const registry = new Map<string, InvoiceFormatGenerator>();
	for (const generator of generators) {
		if (registry.has(generator.id)) {
			throw new Error(`duplicate generator registration: ${generator.id}`);
		}
		registry.set(generator.id, generator);
	}
	return registry;
}

/** Every generator mastro ships, registered once. */
export const defaultGeneratorRegistry: GeneratorRegistry = buildGeneratorRegistry([
	itFatturaPaGenerator
]);
