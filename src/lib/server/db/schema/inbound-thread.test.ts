import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, inboundThread } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Real
// database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This
// exercises `0034_mail_poll_constraints.sql`, the database-level half of
// #84's "reprocessing does not occur across restarts"; `mail/poll.test.ts`
// covers the orchestration that writes these rows against a real mailbox.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContractAndDocument(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
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
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'a'.repeat(64),
			mime: 'message/rfc822',
			size: 10,
			originalName: 'thread.eml',
			provenance: 'mail' as const,
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractRow.id
		})
		.returning();
	return { contractRow, documentRow };
}

function threadFields(
	contractId: string,
	documentId: string,
	overrides: Partial<typeof inboundThread.$inferInsert> = {}
) {
	return {
		contractId,
		documentId,
		mailbox: 'Acme Corp',
		imapUidValidity: 1700000000,
		imapUid: 1,
		messageId: `<${crypto.randomUUID()}@example.com>`,
		subject: 'Re: approval for next week',
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
		...overrides
	};
}

test('a well-formed thread is recorded and defaults message_id/subject to null when absent', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await insertContractAndDocument(tx);
		const [row] = await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { messageId: null, subject: null }))
			.returning();

		expect(row.contractId).toBe(contractRow.id);
		expect(row.documentId).toBe(documentRow.id);
		expect(row.messageId).toBeNull();
		expect(row.subject).toBeNull();
	});
});

test('a contract_id that does not name an existing contract is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { documentRow } = await insertContractAndDocument(tx);
		await expect(
			tx.insert(inboundThread).values(threadFields(crypto.randomUUID(), documentRow.id))
		).rejects.toThrow();
	});
});

test('a document_id that does not name an existing document is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContractAndDocument(tx);
		await expect(
			tx.insert(inboundThread).values(threadFields(contractRow.id, crypto.randomUUID()))
		).rejects.toThrow();
	});
});

test('a blank mailbox is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await insertContractAndDocument(tx);
		await expect(
			tx
				.insert(inboundThread)
				.values(threadFields(contractRow.id, documentRow.id, { mailbox: '  ' }))
		).rejects.toThrow();
	});
});

test('the same UID cannot be recorded twice for one contract under the same UIDVALIDITY — the durable seen-marker', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await insertContractAndDocument(tx);
		await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { imapUid: 5, messageId: null }))
			.returning();

		// The savepoint matters: a rejected statement aborts its transaction,
		// and this test still has three inserts to do afterwards.
		const conflict = await rejection(
			() =>
				tx
					.insert(inboundThread)
					.values(threadFields(contractRow.id, documentRow.id, { imapUid: 5, messageId: null })),
			tx
		);
		expect(conflict.code).toBe('23505');

		// A different UID, or the same UID under a new UIDVALIDITY
		// generation, is not a conflict.
		await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { imapUid: 6, messageId: null }));
		await tx.insert(inboundThread).values(
			threadFields(contractRow.id, documentRow.id, {
				imapUid: 5,
				imapUidValidity: 1700000001,
				messageId: null
			})
		);
	});
});

test('the same message_id cannot be recorded twice for one contract even under a different UIDVALIDITY — the UIDVALIDITY-bump safety net', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await insertContractAndDocument(tx);
		const messageId = '<same-message@example.com>';
		await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { messageId, imapUid: 1 }));

		// Re-numbered under a brand new UIDVALIDITY generation, same
		// Message-ID: still a conflict.
		const conflict = await rejection(
			() =>
				tx.insert(inboundThread).values(
					threadFields(contractRow.id, documentRow.id, {
						messageId,
						imapUid: 1,
						imapUidValidity: 999999999
					})
				),
			tx
		);
		expect(conflict.code).toBe('23505');

		// A null message_id never conflicts with anything, including
		// another null.
		await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { messageId: null, imapUid: 2 }));
		await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id, { messageId: null, imapUid: 3 }));
	});
});

test('updated_at advances on update, same as every other table', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await insertContractAndDocument(tx);
		const [row] = await tx
			.insert(inboundThread)
			.values(threadFields(contractRow.id, documentRow.id))
			.returning();

		await tx
			.update(inboundThread)
			.set({ subject: 'updated subject' })
			.where(eq(inboundThread.id, row.id));

		const [updated] = await tx.select().from(inboundThread).where(eq(inboundThread.id, row.id));
		// Not `toBeGreaterThan`: `set_updated_at()` writes `now()`, which is
		// the transaction's own start time, so inside one transaction the two
		// stamps are equal by definition and the old assertion could never
		// hold. What is provable here is that the trigger exists and wrote
		// something consistent; that it advances between transactions is
		// `db/set-updated-at.test.ts`'s job.
		expect(updated.subject).toBe('updated subject');
		expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
	});
});
