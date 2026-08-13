import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import {
	approval,
	client,
	contract,
	document,
	inboundThread,
	workUnit
} from '$lib/server/db/schema';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import {
	acceptProposal,
	createProposal,
	diffProposalFields,
	getProposal,
	rejectProposal
} from './proposal';
import { createWorkUnit, getWorkUnit } from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/work-unit.test.ts`. `acceptProposal` now reads and
// archives real bytes (#209: it parses the source message's own `From`
// header for the approval it creates), so `insertDocument` writes through
// `storeDocument`, the same real filesystem side effect a rollback cannot
// undo — `DOCUMENT_STORAGE_ROOT` points at a throwaway temp directory
// removed in `afterEach`, same as `repositories/approval.test.ts`.
//
// The "no bypass" tests (#83's acceptance) call `acceptProposal` inside its
// own nested transaction (a real Postgres SAVEPOINT — see
// `postgres-js/session.ts`), so a rejected write rolls back only that
// nested transaction and the outer, rolled-back-at-the-end test
// transaction stays usable afterwards to prove the proposal was left
// exactly as it was.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-proposals-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

/**
 * Archives a document in the same shape the mail poller leaves behind —
 * raw RFC 822 bytes carrying a `From` header, owned by the contract — and
 * records the matching `inbound_thread` row: `acceptProposal`'s
 * `approvalForDocument` (#209) reads the header for `approval.sender` and
 * the thread for `receivedAt`/`messageId`, so every test that accepts a
 * proposal needs both, not just a bare `document` row.
 */
async function insertDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string,
	options: { sender?: string } = {}
) {
	counter += 1;
	const sender = options.sender ?? 'ops@client.example';
	const raw = [
		`From: ${sender}`,
		'To: agent@mastro.example',
		'Subject: Giornate',
		'',
		'ok for Monday'
	].join('\r\n');
	const row = await storeDocument(
		{
			bytes: new TextEncoder().encode(raw),
			mime: 'message/rfc822',
			originalName: 'approval.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		},
		tx
	);
	await tx.insert(inboundThread).values({
		contractId,
		documentId: row.id,
		mailbox: 'INBOX',
		imapUidValidity: 1,
		imapUid: counter,
		messageId: `<${crypto.randomUUID()}@example.com>`,
		subject: 'Giornate',
		receivedAt: new Date('2024-05-01T09:00:00Z')
	});
	return row;
}

test('createProposal records a pending proposal with no decision yet', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);

		expect(created.status).toBe('pending');
		expect(created.acceptedFields).toBeNull();
		expect(created.resultId).toBeNull();

		const fetched = await getProposal(created.id, tx);
		expect(fetched?.proposedFields).toEqual({
			date: '2024-06-10',
			quantity: 1,
			scope: 'API migration'
		});
	});
});

test('#209: accepting a proposal writes the day already approved, linked to an approval built from the source message', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id, { sender: 'ops@client.example' });
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);

		const accepted = await acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, tx);

		expect(accepted.status).toBe('accepted');
		expect(accepted.acceptedFields).toEqual(created.proposedFields);
		expect(accepted.decidedBy).toBe('lorenzo@example.com');
		expect(accepted.resultId).toBeTruthy();
		expect(diffProposalFields(accepted)).toEqual([]);

		const [workUnitRow] = await tx
			.select()
			.from(workUnit)
			.where(eq(workUnit.id, accepted.resultId as string));
		expect(workUnitRow.contractId).toBe(contractRow.id);
		expect(workUnitRow.date).toBe('2024-06-10');
		expect(Number(workUnitRow.quantity)).toBe(1);
		expect(workUnitRow.scope).toBe('API migration');
		// #209: a proposal only exists because a human wrote something
		// approving it, so accepting one writes the day straight to
		// `approved`, never leaving it at merely `proposed`.
		expect(workUnitRow.state).toBe('approved');
		expect(workUnitRow.approvalId).toBeTruthy();

		const [approvalRow] = await tx
			.select()
			.from(approval)
			.where(eq(approval.id, workUnitRow.approvalId as string));
		expect(approvalRow.contractId).toBe(contractRow.id);
		expect(approvalRow.channel).toBe('email');
		// Read off the archived message's own `From` header, not guessed.
		expect(approvalRow.sender).toBe('ops@client.example');
		// The excerpt this specific day rests on, not the whole message.
		expect(approvalRow.excerpt).toBe('ok for Monday');
		expect(approvalRow.origin).toEqual({ kind: 'agent', proposalReference: created.id });
		// The approval's document is the source message itself, re-pointed
		// — never a second archive of the same bytes.
		expect(approvalRow.documentId).toBe(documentRow.id);

		const [refetchedDocument] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		expect(refetchedDocument.ownerType).toBe('approval');
		expect(refetchedDocument.ownerId).toBe(approvalRow.id);
	});
});

test('#209: two proposals from the same document share one approval, not one each', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id, { sender: 'ops@client.example' });

		const thursday = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-13', quantity: 1, scope: 'Thursday' },
				excerpt: 'ok for Thursday',
				confidence: 0.9
			},
			tx
		);
		const friday = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-14', quantity: 0.5, scope: 'Friday' },
				excerpt: 'and half of Friday',
				confidence: 0.9
			},
			tx
		);

		const acceptedThursday = await acceptProposal(
			thursday.id,
			{ decidedBy: 'lorenzo@example.com' },
			tx
		);
		const acceptedFriday = await acceptProposal(
			friday.id,
			{ decidedBy: 'lorenzo@example.com' },
			tx
		);

		const thursdayUnit = await getWorkUnit(acceptedThursday.resultId as string, tx);
		const fridayUnit = await getWorkUnit(acceptedFriday.resultId as string, tx);
		expect(thursdayUnit?.approvalId).toBeTruthy();
		expect(fridayUnit?.approvalId).toBe(thursdayUnit?.approvalId);

		const approvals = await tx
			.select()
			.from(approval)
			.where(eq(approval.contractId, contractRow.id));
		expect(approvals).toHaveLength(1);
		// The shared approval's own excerpt is whichever proposal created it
		// first (Thursday's) — each proposal still keeps its own excerpt on
		// its own row, which #83's `diffProposalFields`/review screen reads.
		expect(approvals[0].excerpt).toBe('ok for Thursday');
	});
});

test('accepting with an edit writes the edited value and records exactly what changed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);

		const accepted = await acceptProposal(
			created.id,
			{ edits: { quantity: 0.5 }, decidedBy: 'lorenzo@example.com' },
			tx
		);

		expect(accepted.acceptedFields).toEqual({
			date: '2024-06-10',
			quantity: 0.5,
			scope: 'API migration'
		});
		expect(diffProposalFields(accepted)).toEqual([
			{ field: 'quantity', proposed: 1, accepted: 0.5 }
		]);

		const [workUnitRow] = await tx
			.select()
			.from(workUnit)
			.where(eq(workUnit.id, accepted.resultId as string));
		expect(Number(workUnitRow.quantity)).toBe(0.5);
	});
});

test('rejecting a proposal writes nothing to work_unit or approval, and leaves the source document alone', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);

		const rejected = await rejectProposal(created.id, 'lorenzo@example.com', tx);

		expect(rejected.status).toBe('rejected');
		expect(rejected.acceptedFields).toBeNull();
		expect(rejected.resultId).toBeNull();

		const rows = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractRow.id));
		expect(rows).toHaveLength(0);

		// #209: reject never creates the evidence either — no approval, and
		// the source document stays exactly where the poller left it.
		const approvals = await tx
			.select()
			.from(approval)
			.where(eq(approval.contractId, contractRow.id));
		expect(approvals).toHaveLength(0);
		const [stillOwnedByContract] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		expect(stillOwnedByContract.ownerType).toBe('contract');
		expect(stillOwnedByContract.ownerId).toBe(contractRow.id);
	});
});

test('an already-decided proposal cannot be accepted or rejected again', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);
		await acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, tx);

		expect(
			(await rejection(() => acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, tx)))
				.message
		).toMatch(/already been decided/);
		expect(
			(await rejection(() => rejectProposal(created.id, 'lorenzo@example.com', tx))).message
		).toMatch(/already been decided/);
	});
});

test('#245: an invalid quantity is refused by acceptProposal itself, before it ever reaches the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				// No human day-entry form would ever submit this either — the
				// point is that nothing about going through a proposal lets it
				// slip past `work_unit_quantity_positive`. Before #245 this was
				// caught by the database, at accept time, after
				// `approvalForDocument` had already run; now `acceptProposal`
				// itself refuses it first, naming the field, and nothing about
				// accepting is even attempted.
				proposedFields: { date: '2024-06-10', quantity: -1, scope: 'API migration' },
				excerpt: 'ok for Monday, apparently for a negative amount of it',
				confidence: 0.4
			},
			tx
		);
		expect(created.validationError).toMatch(/quantity -1 must be greater than 0/);

		await expect(
			tx.transaction((nested) =>
				acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, nested)
			)
		).rejects.toThrow(/quantity -1 must be greater than 0/);

		const stillPending = await getProposal(created.id, tx);
		expect(stillPending?.status).toBe('pending');
		expect(stillPending?.acceptedFields).toBeNull();

		const rows = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractRow.id));
		expect(rows).toHaveLength(0);
		// #245's guard runs before `applyProposal`, so `approvalForDocument`
		// is never even reached for a proposal this broken.
		const approvals = await tx
			.select()
			.from(approval)
			.where(eq(approval.contractId, contractRow.id));
		expect(approvals).toHaveLength(0);
	});
});

test('#83 no bypass: a day that already exists for the contract and date is rejected the same way a duplicate manual entry would be', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-10', quantity: 1, scope: 'Already recorded.' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'entered by hand before the proposal arrived',
			tx
		);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'A different description.' },
				excerpt: 'ok for the 10th',
				confidence: 0.8
			},
			tx
		);

		await expect(
			tx.transaction((nested) =>
				acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, nested)
			)
		).rejects.toSatisfy((error) =>
			isPostgresConstraintViolation(error, '23505', 'work_unit_one_active_per_contract_date')
		);

		const stillPending = await getProposal(created.id, tx);
		expect(stillPending?.status).toBe('pending');

		const rows = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractRow.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].scope).toBe('Already recorded.');
	});
});

test('#245: a proposal whose fields the database would reject is marked with the offending field, not just left to fail later', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		// The contract-PDF spike's own failure shape, translated to the one
		// target type this table supports today: a quantity the
		// `work_unit_quantity_positive` CHECK would reject.
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 0, scope: 'API migration' },
				excerpt: 'ok for Monday, apparently for none of it',
				confidence: 0.4
			},
			tx
		);

		expect(created.status).toBe('pending');
		expect(created.validationError).toMatch(/quantity/);
		expect(created.validationError).toMatch(/greater than 0/);
	});
});

test('#245: a proposal whose fields the database would accept carries no validation error', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);

		expect(created.validationError).toBeNull();
	});
});

test('#244: confidenceReason is stored alongside confidence, null when the producer had nothing to say', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const unsure = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'vediamo come va questa settimana',
				confidence: 0.15,
				confidenceReason: 'the message reads as non-committal, not a firm approval'
			},
			tx
		);
		expect(unsure.confidenceReason).toBe('the message reads as non-committal, not a firm approval');

		const documentRow2 = await insertDocument(tx, contractRow.id);
		const sure = await createProposal(
			{
				documentId: documentRow2.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-11', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Tuesday',
				confidence: 0.95
			},
			tx
		);
		expect(sure.confidenceReason).toBeNull();
	});
});

test('#245: an edit that fixes the offending field on the review screen is accepted normally', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 0, scope: 'API migration' },
				excerpt: 'ok for Monday, apparently for none of it',
				confidence: 0.4
			},
			tx
		);
		expect(created.validationError).not.toBeNull();

		// The reviewer corrects the field the proposal itself flagged as
		// broken — the guard has to look at what is actually about to be
		// written, not the stale flag from creation, or a correction on the
		// review screen could never be accepted at all.
		const accepted = await acceptProposal(
			created.id,
			{ edits: { quantity: 1 }, decidedBy: 'lorenzo@example.com' },
			tx
		);
		expect(accepted.status).toBe('accepted');
		expect(accepted.acceptedFields).toMatchObject({ quantity: 1 });
	});
});
