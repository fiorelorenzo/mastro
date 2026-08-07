import { expect, test } from 'vitest';
import { readAccountHolderTaxId } from './config';

test('a configured tax id is returned trimmed', () => {
	expect(readAccountHolderTaxId(' IT01234567890 ')).toBe('IT01234567890');
});

test('an unset value throws rather than silently guessing', () => {
	expect(() => readAccountHolderTaxId(undefined)).toThrow(/ACCOUNT_HOLDER_TAX_ID/);
	expect(() => readAccountHolderTaxId(null)).toThrow(/ACCOUNT_HOLDER_TAX_ID/);
});

test('a blank value is treated the same as unset', () => {
	expect(() => readAccountHolderTaxId('   ')).toThrow(/ACCOUNT_HOLDER_TAX_ID/);
});

// The regression gate for #133 is CI's own build step, which runs with no
// `.env` and, deliberately, no ACCOUNT_HOLDER_TAX_ID: a module-level read
// would fail it. It cannot be asserted from here, because SvelteKit's
// dynamic private env is snapshotted once per process, so a test cannot
// unset a variable this process started with.
