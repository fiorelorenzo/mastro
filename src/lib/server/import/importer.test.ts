// AGENTS.md invariant 1, applied to import instead of fiscal rules:
// `importer.ts` and `adapter.ts` are the engine — the interface and
// resolver every format adapter, present and future, runs through.
// `registry.ts` is deliberately exempt, mirroring `fiscal/registry.ts` and
// `fiscal/engine.test.ts`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { NO_MINOR_UNITS } from '$lib/money';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import { importFile, resolveAdapter } from './importer';
import { buildAdapterRegistry } from './registry';
import type { Invoice, InvoiceParty } from './invoice';

const engineFiles = ['./importer.ts', './adapter.ts'];

test('the engine names no concrete format id or format', () => {
	for (const file of engineFiles) {
		const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
		expect(source, `${file} should not name the FatturaPA format id`).not.toMatch(/FPR12/);
		expect(source, `${file} should not mention FatturaPA by name`).not.toMatch(/fattura/i);
	}
});

function imaginaryParty(): InvoiceParty {
	return {
		legalName: 'Imaginary Party',
		taxId: 'QQ00000000000',
		country: 'QQ',
		addressLine1: 'Nowhere Street 1',
		addressCity: 'Nowhere',
		addressPostalCode: '00000'
	};
}

function imaginaryInvoice(): Invoice {
	return {
		number: '1/imaginary',
		issueDate: '2024-01-01',
		documentType: 'invoice',
		currency: 'QQD',
		supplier: imaginaryParty(),
		customer: imaginaryParty(),
		lines: [],
		taxSummary: [],
		taxableAmount: NO_MINOR_UNITS,
		taxAmount: NO_MINOR_UNITS,
		total: NO_MINOR_UNITS,
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: 'QQ00000000000', progressiveNumber: '1' }
	};
}

function fakeFile(filename: string, marker: string): ImportableFile {
	return { filename, content: new TextEncoder().encode(marker) };
}

// A format registered nowhere else in the codebase. If resolution or
// reporting needs anything beyond the `InvoiceFormatAdapter` interface and
// a pack's `formats` list, the engine has a hidden special case.
const imaginaryAdapter: InvoiceFormatAdapter = {
	id: 'qq-imaginary-format',
	detect: (file) => new TextDecoder().decode(file.content) === 'imaginary-marker',
	parse: () => [imaginaryInvoice()]
};

test('resolveAdapter finds an adapter registered under a format the active pack declares', () => {
	const registry = buildAdapterRegistry([imaginaryAdapter]);
	const pack = { formats: ['qq-imaginary-format'] };
	expect(resolveAdapter(pack, registry, fakeFile('doc.bin', 'imaginary-marker'))?.id).toBe(
		'qq-imaginary-format'
	);
});

test('resolveAdapter never considers an adapter for a format the active pack does not declare', () => {
	// Mirrors the generic pack: `formats: []` means no adapter is ever
	// resolved, whatever is registered.
	const registry = buildAdapterRegistry([imaginaryAdapter]);
	const pack = { formats: [] as string[] };
	expect(resolveAdapter(pack, registry, fakeFile('doc.bin', 'imaginary-marker'))).toBeNull();
});

test('resolveAdapter returns null when the declared format is registered but detect rejects the file', () => {
	const registry = buildAdapterRegistry([imaginaryAdapter]);
	const pack = { formats: ['qq-imaginary-format'] };
	expect(resolveAdapter(pack, registry, fakeFile('doc.bin', 'something else'))).toBeNull();
});

test('importFile reports an unclaimed file clearly, never silently', () => {
	const registry = buildAdapterRegistry([imaginaryAdapter]);
	const pack = { formats: ['qq-imaginary-format'] };
	expect(importFile(pack, registry, fakeFile('unrelated.bin', 'something else'))).toEqual({
		kind: 'unclaimed',
		filename: 'unrelated.bin'
	});
});

test('importFile returns the invoices the resolved adapter parsed', () => {
	const registry = buildAdapterRegistry([imaginaryAdapter]);
	const pack = { formats: ['qq-imaginary-format'] };
	const result = importFile(pack, registry, fakeFile('doc.bin', 'imaginary-marker'));
	expect(result).toEqual({
		kind: 'parsed',
		adapterId: 'qq-imaginary-format',
		invoices: [imaginaryInvoice()]
	});
	if (result.kind !== 'parsed') throw new Error('unreachable');
	expect(result.invoices).toHaveLength(1);
});
