import { eq, sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, documentMirrorRun } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back
// — see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This
// exercises `0018_document_mirror_run.sql`/`0019_document_mirror_run_
// constraints.sql`, the database-level half of #50's "a failed publish is
// visible" acceptance; `src/lib/server/drive/publish.test.ts` covers the
// orchestration that writes these rows.

afterAll(async () => {
	await pool.end();
});

async function insertDocument(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
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
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'a'.repeat(64),
			mime: 'application/pdf',
			size: 10,
			originalName: 'contract.pdf',
			provenance: 'upload' as const,
			contractId: contractRow.id,
			confidential: false,
			ownerType: 'contract' as const,
			ownerId: contractRow.id
		})
		.returning();
	return documentRow;
}

test('a mirror run is recorded with its status and stays unacknowledged by default', async () => {
	await expect(
		db.transaction(async (tx) => {
			const documentRow = await insertDocument(tx);
			const [failure] = await tx
				.insert(documentMirrorRun)
				.values({ documentId: documentRow.id, status: 'failure', detail: 'Drive quota exceeded' })
				.returning();

			expect(failure.status).toBe('failure');
			expect(failure.detail).toBe('Drive quota exceeded');
			expect(failure.acknowledgedAt).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a status outside success/failure is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const documentRow = await insertDocument(tx);
			await expect(
				tx.execute(
					sql`insert into document_mirror_run (document_id, status) values (${documentRow.id}, 'partial')`
				)
			).rejects.toThrow();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a document_id that does not name an existing document is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			await expect(
				tx.insert(documentMirrorRun).values({ documentId: crypto.randomUUID(), status: 'success' })
			).rejects.toThrow();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('acknowledging a run stops it looking like the newest failure', async () => {
	await expect(
		db.transaction(async (tx) => {
			const documentRow = await insertDocument(tx);
			const [row] = await tx
				.insert(documentMirrorRun)
				.values({ documentId: documentRow.id, status: 'failure' })
				.returning();

			await tx
				.update(documentMirrorRun)
				.set({ acknowledgedAt: new Date() })
				.where(eq(documentMirrorRun.id, row.id));

			const [updated] = await tx
				.select()
				.from(documentMirrorRun)
				.where(eq(documentMirrorRun.id, row.id));
			expect(updated.acknowledgedAt).not.toBeNull();
			expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());

			tx.rollback();
		})
	).rejects.toThrow();
});
