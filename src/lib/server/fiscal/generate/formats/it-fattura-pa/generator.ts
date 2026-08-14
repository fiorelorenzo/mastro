// The FatturaPA 1.2 generator (#260): the first concrete
// `InvoiceFormatGenerator` (mirrors `import/formats/fattura-pa/adapter.ts`,
// the first concrete `InvoiceFormatAdapter`, #42). `id` is `'FPR12'`, the
// same transmission-format code the import adapter registers under — a
// jurisdiction pack that lists `'FPR12'` in `formats` gets both directions
// for free, one registry lookup each.

import type {
	GeneratableInvoice,
	GeneratableParty,
	GeneratedInvoiceDocument,
	InvoiceFormatGenerator
} from '../../generator';
import type { FiscalPack } from '../../../pack';
import { buildFatturaPaXml } from './xml';

const FORMAT_ID = 'FPR12';

/** Agenzia delle Entrate's own filename convention for a FatturaPA file
 * (`<CountryCode><VATNumber>_<free-form progressive>.xml`) — not read by
 * XSD validation itself, but the shape every transmission channel in
 * `docs/specs/2026-08-14-electronic-invoicing.md`'s §2 (PEC, the web
 * portal, SDICoop) expects a self-hoster to hand it. Falls back to
 * `taxId` for the rare pack-generic case where `vatId` is absent — never
 * reached by either shipped Italian pack, both of which `buildFatturaPaXml`
 * already requires a `vatId` for, but a bare filename fallback here is
 * cheaper than teaching this function about that invariant twice. */
function filenameFor(practiceProfile: GeneratableParty, invoice: GeneratableInvoice): string {
	const issuerId = (practiceProfile.vatId ?? practiceProfile.taxId).replace(/[^A-Za-z0-9]/g, '');
	const safeNumber = invoice.number.replace(/[^A-Za-z0-9]/g, '');
	return `${issuerId}_${safeNumber}.xml`;
}

function generate(
	invoice: GeneratableInvoice,
	practiceProfile: GeneratableParty,
	pack: FiscalPack
): GeneratedInvoiceDocument {
	const xml = buildFatturaPaXml(invoice, practiceProfile, pack);
	return {
		bytes: new TextEncoder().encode(xml),
		mime: 'application/xml',
		filename: filenameFor(practiceProfile, invoice)
	};
}

export const itFatturaPaGenerator: InvoiceFormatGenerator = { id: FORMAT_ID, generate };
