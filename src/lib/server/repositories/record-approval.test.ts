import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { approval, client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { getApprovalDocument, recordApproval } from './approval';
import { readDocumentBytes } from './document';
import { createWorkUnit, getWorkUnit, getWorkUnitDocument } from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/approval.test.ts` and `repositories/work-unit.test.ts`.
// `recordApproval` writes a document to disk, so `DOCUMENT_STORAGE_ROOT`
// points at a throwaway temp directory removed in `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-record-approval-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	requiresPriorApproval: boolean
) {
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval
		})
		.returning();
	return contractRow;
}

test('recordApproval archives an uploaded file as the proof, with no day to link', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		const approvalRow = await recordApproval(
			{
				contractId: contractRow.id,
				channel: 'certified_mail',
				sender: 'client@example.com',
				receivedAt: new Date('2026-06-01T10:00:00Z'),
				messageId: null,
				excerpt: 'Confirmed by certified mail, the three days are approved.',
				origin: { kind: 'manual' },
				document: {
					bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
					mime: 'application/pdf',
					originalName: 'certified-mail-scan.pdf',
					provenance: 'upload',
					confidential: true
				}
			},
			null,
			tx
		);

		const archived = await getApprovalDocument(approvalRow.id, tx);
		expect(archived?.originalName).toBe('certified-mail-scan.pdf');
		expect(archived?.mime).toBe('application/pdf');
		expect(archived?.confidential).toBe(true);
	});
});

test('recordApproval archives pasted text as the proof, as a text/plain document', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		const pastedText = 'Sent via WhatsApp: "yes, go ahead with the three days next week."';
		const approvalRow = await recordApproval(
			{
				contractId: contractRow.id,
				channel: 'other',
				sender: '+39 333 1234567',
				receivedAt: new Date('2026-06-02T08:30:00Z'),
				messageId: null,
				excerpt: pastedText,
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode(pastedText),
					mime: 'text/plain',
					originalName: 'approval-proof.txt',
					provenance: 'upload',
					confidential: false
				}
			},
			null,
			tx
		);

		const archived = await getApprovalDocument(approvalRow.id, tx);
		expect(archived?.mime).toBe('text/plain');
		expect(archived && Buffer.from(await readDocumentBytes(archived)).toString('utf8')).toBe(
			pastedText
		);
	});
});

test('recordApproval, given a day sitting in worked_without_approval, links and recovers it in the same transaction', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);

		const dayRow = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-06-03',
				quantity: 1,
				scope: 'Emergency hotfix, approved after the fact.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded the same day it happened',
			tx
		);
		expect(dayRow.state).toBe('worked_without_approval');

		const approvalRow = await recordApproval(
			{
				contractId: contractRow.id,
				channel: 'other',
				sender: 'client (phone call)',
				receivedAt: new Date('2026-06-04T09:00:00Z'),
				messageId: null,
				excerpt: 'Confirmed by phone: go ahead, that emergency fix is approved.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Call notes: approved over the phone.'),
					mime: 'text/plain',
					originalName: 'call-notes.txt',
					provenance: 'upload',
					confidential: false
				}
			},
			{
				workUnitId: dayRow.id,
				actor: { kind: 'human', email: 'lorenzo@example.com' },
				reason: 'approval recorded from the manual approval form'
			},
			tx
		);

		const recovered = await getWorkUnit(dayRow.id, tx);
		expect(recovered?.state).toBe('worked');
		expect(recovered?.approvalId).toBe(approvalRow.id);

		// The proof is reachable from the day side too, not only from the
		// approval — #210's "the archived proof is reachable afterwards".
		const viaWorkUnit = await getWorkUnitDocument(dayRow.id, tx);
		expect(viaWorkUnit?.originalName).toBe('call-notes.txt');
	});
});

test('an approval recorded through recordApproval is still immutable: an edit is rejected by the trigger', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		const approvalRow = await recordApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2026-06-05T09:00:00Z'),
				messageId: null,
				excerpt: 'Yes, go ahead.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Yes, go ahead.'),
					mime: 'text/plain',
					originalName: 'proof.txt',
					provenance: 'upload',
					confidential: false
				}
			},
			null,
			tx
		);

		// `approval_immutable` (`0011_approval_constraints.sql`) is a
		// RAISE EXCEPTION trigger, not a CHECK constraint — it never sets
		// `constraint_name` (confirmed against the running database), so the
		// established assertion for this specific trigger, already used by
		// `db/schema/approval.test.ts`, is the message it raises.
		const rejected = await rejection(
			() =>
				tx
					.update(approval)
					.set({ excerpt: 'a different excerpt entirely' })
					.where(eq(approval.id, approvalRow.id)),
			tx
		);
		expect(rejected.code).toBe('P0001');
		expect(rejected.constraint_name).toBeUndefined();
		expect(rejected.message).toMatch(/immutable once written/);
	});
});
