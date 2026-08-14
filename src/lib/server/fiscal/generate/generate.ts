// The generation-direction sibling of `import/importer.ts` (#260):
// resolves a generator for the active jurisdiction pack's declared
// formats, and reports a pack with no matching generator instead of
// guessing one. Nothing here may name a concrete generator or format id —
// see `generate.test.ts` for the standing proof, mirroring
// `import/importer.test.ts`.

import type { FiscalPack } from '../pack';
import type {
	GeneratableInvoice,
	GeneratableParty,
	GeneratedInvoiceDocument,
	InvoiceFormatGenerator
} from './generator';
import type { GeneratorRegistry } from './registry';

/**
 * The generator for one of `pack.formats`, or `null` if none is
 * registered under any of them. Unlike `import/importer.ts`'s
 * `resolveAdapter`, there is no candidate document to `detect` against —
 * generation always targets the active pack's own declared format, so the
 * first format id in `pack.formats` with a registered generator wins.
 * `formats` is a pack's own ordered list; a pack that ever needs to prefer
 * one registered format over another expresses that by listing it first,
 * never by this function guessing.
 */
export function resolveGenerator(
	pack: Pick<FiscalPack, 'formats'>,
	registry: GeneratorRegistry
): InvoiceFormatGenerator | null {
	for (const formatId of pack.formats) {
		const generator = registry.get(formatId);
		if (generator) return generator;
	}
	return null;
}

/**
 * Resolves a generator for `pack` and renders `invoice` through it, or
 * `null` when no registered generator matches any format `pack` declares
 * (the generic pack, most concretely — it declares no formats at all, so
 * this always returns `null` for it, never a guessed document).
 */
export function generateInvoiceDocument(
	invoice: GeneratableInvoice,
	practiceProfile: GeneratableParty,
	pack: FiscalPack,
	registry: GeneratorRegistry
): GeneratedInvoiceDocument | null {
	const generator = resolveGenerator(pack, registry);
	if (!generator) return null;
	return generator.generate(invoice, practiceProfile, pack);
}
