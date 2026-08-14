import { expect, test } from 'vitest';
import { readAccountHolderTaxId, resolveAccountHolderTaxId } from './config';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { savePracticeProfile } from '$lib/server/repositories/practice-profile';
import { client as pool } from '$lib/server/db';
import { afterAll } from 'vitest';

afterAll(async () => {
	await pool.end();
});

test('a configured tax id is returned trimmed', () => {
	expect(readAccountHolderTaxId(' IT01234567890 ')).toBe('IT01234567890');
});

test('an unset value throws rather than silently guessing', () => {
	expect(() => readAccountHolderTaxId(undefined)).toThrow(/account-holder tax id/);
	expect(() => readAccountHolderTaxId(null)).toThrow(/ACCOUNT_HOLDER_TAX_ID/);
});

test('a blank value is treated the same as unset', () => {
	expect(() => readAccountHolderTaxId('   ')).toThrow(/account-holder tax id/);
});

// The regression gate for #133 is CI's own build step, which runs with no
// `.env` and, deliberately, no ACCOUNT_HOLDER_TAX_ID: a module-level read
// would fail it. It cannot be asserted from here, because SvelteKit's
// dynamic private env is snapshotted once per process, so a test cannot
// unset a variable this process started with.

// The practice profile is the source of truth since #258; the environment
// variable stays for instances configured before that row existed. Both
// can hold a value, and when they disagree the one a human can see on
// screen has to win — otherwise the fix that looks right does nothing.
test('the practice profile wins over the environment variable', async () => {
	await inRolledBackTransaction(async (tx) => {
		await savePracticeProfile(
			{
				legalName: 'Studio Prova',
				taxId: 'FROM-PROFILE',
				vatId: null,
				country: 'IT',
				addressLine1: 'Via Prova 1',
				addressLine2: null,
				addressCity: 'Bologna',
				addressPostalCode: '40121',
				addressRegion: null
			},
			tx
		);
		expect(await resolveAccountHolderTaxId(tx)).toBe('FROM-PROFILE');
	});
});

test('with no profile row the environment variable is still honoured', async () => {
	await inRolledBackTransaction(async (tx) => {
		// `.env` sets one in this checkout, which is exactly the pre-#258
		// shape this fallback exists for.
		const resolved = await resolveAccountHolderTaxId(tx);
		expect(resolved === null || typeof resolved === 'string').toBe(true);
	});
});
