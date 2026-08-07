import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise the constraints in `0008_document_constraints.sql`, the
// database-level half of #49's acceptance; `document.test.ts` in
// `src/lib/server/repositories` covers the disk + Postgres orchestration.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	counter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${counter}`,
			taxId: `TEST-TAX-${counter}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

function documentFields(contractId: string, overrides: Partial<typeof document.$inferInsert> = {}) {
	return {
		hash: 'a'.repeat(64),
		mime: 'application/pdf',
		size: 1024,
		originalName: 'contract.pdf',
		provenance: 'upload' as const,
		contractId,
		confidential: false,
		ownerType: 'contract' as const,
		ownerId: contractId,
		...overrides
	};
}

test('a well-formed document owned by its contract is accepted', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const [row] = await tx.insert(document).values(documentFields(contractRow.id)).returning();
			expect(row.hash).toBe('a'.repeat(64));
			expect(row.confidential).toBe(false);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('confidential has no default and cannot be omitted, even bypassing the TypeScript type', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const fields = documentFields(contractRow.id) as Record<string, unknown>;
			delete fields.confidential;

			await expect(tx.insert(document).values(fields as never)).rejects.toThrow();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a malformed hash is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			await expect(
				tx.insert(document).values(documentFields(contractRow.id, { hash: 'not-a-hash' }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'document_hash_is_sha256_hex' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a non-positive size is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			await expect(
				tx.insert(document).values(documentFields(contractRow.id, { size: 0 }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'document_size_positive' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an owner_id that does not name an existing contract is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			await expect(
				tx.insert(document).values(
					documentFields(contractRow.id, {
						ownerId: '00000000-0000-0000-0000-000000000000'
					})
				)
			).rejects.toThrow(/does not reference an existing contract/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an owner_type outside the known set is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			await expect(
				tx.insert(document).values(
					documentFields(contractRow.id, {
						ownerType: 'invoice' as never
					})
				)
			).rejects.toMatchObject({ code: '23514', constraint_name: 'document_owner_type_known' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('confidential cannot be changed after creation, not even by a direct update', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const [row] = await tx.insert(document).values(documentFields(contractRow.id)).returning();

			await expect(
				tx.update(document).set({ confidential: true }).where(eq(document.id, row.id))
			).rejects.toThrow(/immutable after ingestion/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('owner_type and owner_id can be repointed, and remote_file_id can be set, after creation', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const otherContract = await insertContract(tx);
			const [row] = await tx.insert(document).values(documentFields(contractRow.id)).returning();

			const [updated] = await tx
				.update(document)
				.set({ ownerType: 'contract', ownerId: otherContract.id, remoteFileId: 'drive-file-1' })
				.where(eq(document.id, row.id))
				.returning();

			expect(updated.ownerId).toBe(otherContract.id);
			expect(updated.remoteFileId).toBe('drive-file-1');

			tx.rollback();
		})
	).rejects.toThrow();
});
