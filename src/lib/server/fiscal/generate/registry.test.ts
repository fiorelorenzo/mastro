import { expect, test } from 'vitest';
import type { GeneratedInvoiceDocument, InvoiceFormatGenerator } from './generator';
import { buildGeneratorRegistry, defaultGeneratorRegistry } from './registry';

function stubGenerator(id: string): InvoiceFormatGenerator {
	return {
		id,
		generate: (): GeneratedInvoiceDocument => {
			throw new Error('not implemented');
		}
	};
}

test('looks a registered generator up by id', () => {
	const registry = buildGeneratorRegistry([stubGenerator('a'), stubGenerator('b')]);
	expect(registry.get('a')?.id).toBe('a');
	expect(registry.get('b')?.id).toBe('b');
});

test('refuses to register the same generator id twice', () => {
	expect(() => buildGeneratorRegistry([stubGenerator('a'), stubGenerator('a')])).toThrow(
		/duplicate/
	);
});

test('an unregistered id is simply absent, not an error', () => {
	const registry = buildGeneratorRegistry([stubGenerator('a')]);
	expect(registry.get('missing')).toBeUndefined();
});

test('the FatturaPA generator ships registered by default under FPR12', () => {
	expect(defaultGeneratorRegistry.get('FPR12')?.id).toBe('FPR12');
});
