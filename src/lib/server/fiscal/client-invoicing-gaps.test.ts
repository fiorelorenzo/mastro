import { expect, test } from 'vitest';
import { clientInvoicingGaps, isClientInvoiceable } from './client-invoicing-gaps';
import { itFlatRatePack } from './packs/it-flat-rate';
import { genericPack } from './packs/generic';

const COMPLETE = {
	taxId: 'IT01234567890',
	addressLine1: 'Via Prova 1',
	addressCity: 'Bologna',
	addressPostalCode: '40121'
};

test('a complete client has no gaps under a pack that declares a format', () => {
	expect(clientInvoicingGaps(COMPLETE, itFlatRatePack)).toEqual([]);
	expect(isClientInvoiceable(COMPLETE, itFlatRatePack)).toBe(true);
});

test('every missing field is named, in the order the form shows them', () => {
	expect(
		clientInvoicingGaps(
			{ taxId: null, addressLine1: null, addressCity: null, addressPostalCode: null },
			itFlatRatePack
		)
	).toEqual(['taxId', 'addressLine1', 'addressCity', 'addressPostalCode']);
});

test('one missing field is reported alone', () => {
	expect(clientInvoicingGaps({ ...COMPLETE, taxId: null }, itFlatRatePack)).toEqual(['taxId']);
	expect(isClientInvoiceable({ ...COMPLETE, taxId: null }, itFlatRatePack)).toBe(false);
});

// A column can hold '' and nothing stops it. A document built from one
// carries an empty CAP, which looks deliberate and is worse than a missing
// one — so blank counts as missing.
test('a blank string counts as missing, not as filled in', () => {
	expect(clientInvoicingGaps({ ...COMPLETE, addressPostalCode: '   ' }, itFlatRatePack)).toEqual([
		'addressPostalCode'
	]);
});

// Invariant 1: the answer comes from the pack's own capability, never from
// reading which country this is.
test('a pack with no invoice format has nothing to be incomplete against', () => {
	const empty = { taxId: null, addressLine1: null, addressCity: null, addressPostalCode: null };
	expect(genericPack.formats).toEqual([]);
	expect(clientInvoicingGaps(empty, genericPack)).toEqual([]);
	expect(isClientInvoiceable(empty, genericPack)).toBe(true);
});
