import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { connectRunnerDb, getHostedExtractionConsentDocumentId } from '$lib/server/runner/db';
import {
	deleteCommittedContract,
	insertCommittedContract
} from '$lib/server/runner/__fixtures__/db-fixtures';
import { client, contract, document, type ExpensePolicy } from '$lib/server/db/schema';
import type { DbExecutor } from '$lib/server/db';
import { revokeHostedExtractionConsent, setHostedExtractionConsentDocument } from './contract';

/** #187: the states the contract screen offers, exercised at the level the
 * page's actions call. `contract.test.ts` already covers one grant and one
 * revocation; what is missing is what happens when consent is given, taken
 * away and given again, which is the sequence a real contract goes through
 * and the one where reusing a stale document would be wrong. */
async function insertContract(tx: DbExecutor) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: 'Consent Probe SRL',
			taxId: `IT${Date.now()}`,
			country: 'IT',
			addressLine1: 'Via Prova 1',
			addressCity: 'Milano',
			addressPostalCode: '20121',
			noticeChannel: 'email'
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Consent probe',
			startsOn: '2026-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

const consent = (name: string) => ({
	bytes: new TextEncoder().encode(`agreed: ${name}`),
	mime: 'application/pdf',
	originalName: name,
	provenance: 'upload' as const,
	confidential: true
});

test('consent granted, withdrawn and granted again points at the new document, not the old one', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			const first = await setHostedExtractionConsentDocument(
				contractRow.id,
				consent('amendment-2026.pdf'),
				tx
			);
			const firstDocumentId = first.hostedExtractionConsentDocumentId;

			await revokeHostedExtractionConsent(contractRow.id, tx);

			const second = await setHostedExtractionConsentDocument(
				contractRow.id,
				consent('amendment-2027.pdf'),
				tx
			);

			expect(second.hostedExtractionConsentDocumentId).not.toBe(firstDocumentId);

			// Both documents survive: consent given and later withdrawn is
			// history, and the runner's refusal reads the column, not the
			// documents, so keeping them costs nothing and losing them would
			// destroy the evidence invariant 4 exists for.
			const archived = await tx
				.select()
				.from(document)
				.where(eq(document.contractId, contractRow.id));
			expect(archived.map((row) => row.originalName).sort()).toEqual([
				'amendment-2026.pdf',
				'amendment-2027.pdf'
			]);

			tx.rollback();
		})
	).rejects.toThrow();
});

// The other half of #187: what the contract screen writes is what the
// runner reads, through the runner's own role rather than the app's. Both
// sides are tested on their own — `contract.test.ts` for the write,
// `runner/routing.test.ts` for the refusal — and neither proves they meet.
// This one commits, because the runner connects separately and cannot see
// another connection's open transaction.
if (!env.RUNNER_DATABASE_URL) {
	throw new Error('RUNNER_DATABASE_URL is not set; see .env.example');
}
const runnerSql = connectRunnerDb(env.RUNNER_DATABASE_URL);
const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
	for (const undo of cleanup.reverse()) await undo();
	await runnerSql.end();
});

test('the runner sees the consent the contract screen archived, and stops seeing it when withdrawn', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));

	expect(await getHostedExtractionConsentDocumentId(runnerSql, contractRow.id)).toBeNull();

	const granted = await setHostedExtractionConsentDocument(
		contractRow.id,
		consent('client-email.eml')
	);
	expect(await getHostedExtractionConsentDocumentId(runnerSql, contractRow.id)).toBe(
		granted.hostedExtractionConsentDocumentId
	);

	await revokeHostedExtractionConsent(contractRow.id);
	expect(await getHostedExtractionConsentDocumentId(runnerSql, contractRow.id)).toBeNull();
});
