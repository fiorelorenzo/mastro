import { expect, test } from 'vitest';
import type { InvoiceFormatAdapter } from './adapter';
import type { Invoice } from './invoice';
import { buildAdapterRegistry, defaultAdapterRegistry } from './registry';

function stubAdapter(id: string): InvoiceFormatAdapter {
	return {
		id,
		detect: () => false,
		parse: (): Invoice[] => {
			throw new Error('not implemented');
		}
	};
}

test('looks a registered adapter up by id', () => {
	const registry = buildAdapterRegistry([stubAdapter('a'), stubAdapter('b')]);
	expect(registry.get('a')?.id).toBe('a');
	expect(registry.get('b')?.id).toBe('b');
});

test('refuses to register the same adapter id twice', () => {
	expect(() => buildAdapterRegistry([stubAdapter('a'), stubAdapter('a')])).toThrow(/duplicate/);
});

test('an unregistered id is simply absent, not an error', () => {
	const registry = buildAdapterRegistry([stubAdapter('a')]);
	expect(registry.get('missing')).toBeUndefined();
});

test('the FatturaPA adapter ships registered by default under FPR12', () => {
	expect(defaultAdapterRegistry.get('FPR12')?.id).toBe('FPR12');
});
