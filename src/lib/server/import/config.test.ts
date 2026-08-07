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
