// AGENTS.md invariant 1, applied to generation instead of import:
// `generate.ts` and `generator.ts` are the engine — the interface and
// resolver every format generator, present and future, runs through.
// `registry.ts` is deliberately exempt, mirroring `import/registry.ts`
// and `import/importer.test.ts`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { NO_MINOR_UNITS, minorUnits } from '$lib/money';
import type { FiscalPack } from '../pack';
import type {
	GeneratableCustomer,
	GeneratableInvoice,
	GeneratableParty,
	GeneratedInvoiceDocument,
	InvoiceFormatGenerator
} from './generator';
import { generateInvoiceDocument, resolveGenerator } from './generate';
import { buildGeneratorRegistry } from './registry';

const engineFiles = ['./generate.ts', './generator.ts'];

test('the engine names no concrete format id or format', () => {
	for (const file of engineFiles) {
		const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf-8');
		expect(source).not.toMatch(/FPR12/);
		expect(source).not.toMatch(/it-fattura-pa/);
	}
});

function imaginaryCustomer(): GeneratableCustomer {
	return {
		legalName: 'Acme Srl',
		taxId: 'IT01234567890',
		vatId: 'IT01234567890',
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressLine2: null,
		addressCity: 'Milano',
		addressPostalCode: '20100',
		addressRegion: 'MI',
		sdiCode: null,
		pecAddress: null
	};
}

function imaginaryInvoice(): GeneratableInvoice {
	return {
		number: 'INV-1',
		issueDate: '2026-03-01',
		documentType: 'invoice',
		currency: 'EUR',
		taxableAmount: minorUnits(10_000),
		taxAmount: NO_MINOR_UNITS,
		total: minorUnits(10_000),
		stampDuty: null,
		socialCharge: null,
		dueDate: '2026-04-01',
		paymentMethod: null,
		iban: null,
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(10_000),
				amount: minorUnits(10_000)
			}
		],
		customer: imaginaryCustomer()
	};
}

function imaginaryPracticeProfile(): GeneratableParty {
	return {
		legalName: 'Jane Doe',
		taxId: 'DOEJNA80A01H501U',
		vatId: 'IT09876543210',
		country: 'IT',
		addressLine1: 'Via Milano 2',
		addressLine2: null,
		addressCity: 'Roma',
		addressPostalCode: '00100',
		addressRegion: 'RM'
	};
}

// A format registered nowhere else in the codebase. If resolution needs
// anything beyond the `InvoiceFormatGenerator` interface and a pack's
// `formats` list, the engine has a hidden special case.
const imaginaryGenerator: InvoiceFormatGenerator = {
	id: 'IMAGINARY',
	generate: (): GeneratedInvoiceDocument => ({
		bytes: new TextEncoder().encode('<imaginary/>'),
		mime: 'application/xml',
		filename: 'imaginary.xml'
	})
};

test('resolveGenerator finds a generator registered under a format the active pack declares', () => {
	const registry = buildGeneratorRegistry([imaginaryGenerator]);
	const pack: Pick<FiscalPack, 'formats'> = { formats: ['IMAGINARY'] };
	expect(resolveGenerator(pack, registry)?.id).toBe('IMAGINARY');
});

test('resolveGenerator never considers a generator for a format the active pack does not declare', () => {
	const registry = buildGeneratorRegistry([imaginaryGenerator]);
	const pack: Pick<FiscalPack, 'formats'> = { formats: ['SOMETHING_ELSE'] };
	expect(resolveGenerator(pack, registry)).toBeNull();
});

test('resolveGenerator returns null for a pack with no formats (the generic pack)', () => {
	const registry = buildGeneratorRegistry([imaginaryGenerator]);
	const pack: Pick<FiscalPack, 'formats'> = { formats: [] };
	expect(resolveGenerator(pack, registry)).toBeNull();
});

test('generateInvoiceDocument returns null when no generator matches, never a guessed document', () => {
	const registry = buildGeneratorRegistry([imaginaryGenerator]);
	const pack: FiscalPack = {
		id: 'imaginary-pack',
		version: '1',
		effectiveFrom: '2020-01-01',
		displayName: { en: 'Imaginary', it: 'Immaginario' },
		basis: 'accrual',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
	expect(
		generateInvoiceDocument(imaginaryInvoice(), imaginaryPracticeProfile(), pack, registry)
	).toBeNull();
});

test('generateInvoiceDocument delegates to the resolved generator', () => {
	const registry = buildGeneratorRegistry([imaginaryGenerator]);
	const pack: FiscalPack = {
		id: 'imaginary-pack',
		version: '1',
		effectiveFrom: '2020-01-01',
		displayName: { en: 'Imaginary', it: 'Immaginario' },
		basis: 'accrual',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: ['IMAGINARY'],
		unresolvedRevenue: 'carries_forward'
	};
	const result = generateInvoiceDocument(
		imaginaryInvoice(),
		imaginaryPracticeProfile(),
		pack,
		registry
	);
	expect(result?.filename).toBe('imaginary.xml');
});
