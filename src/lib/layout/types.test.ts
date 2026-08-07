import { expect, test } from 'vitest';
import { assertUniqueColumnKeys } from './types';

test('a duplicate column key is refused rather than rendered', () => {
	// Both renderings key their loops by column key. A duplicate does not
	// render something slightly wrong, it takes the page down at hydration:
	// that is #143, and again the duplicated crumb hrefs in #152.
	expect(() =>
		assertUniqueColumnKeys([
			{ key: 'amount', label: 'Net' },
			{ key: 'amount', label: 'Gross' }
		])
	).toThrow(/duplicate column key "amount"/);
});

test('distinct keys pass, including ones that only differ late', () => {
	expect(() =>
		assertUniqueColumnKeys([
			{ key: 'amountNet', label: 'Net' },
			{ key: 'amountGross', label: 'Gross' }
		])
	).not.toThrow();
});
