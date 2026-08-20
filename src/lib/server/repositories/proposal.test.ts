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
	clauseNote,
	client,
	contract,
	document,
	inboundThread,
	rateCard,
	workUnit
} from '$lib/server/db/schema';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import {
	acceptProposal,
	countPendingProposals,
	createProposal,
	diffProposalFields,
	getProposal,
	listProposalsForDocuments,
	ProposalValidationError,
	rejectProposal,
	type ClientChoice
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

/** A client already on file, independent of any proposal — the shape a
 * `'existing'` `ClientChoice` links against. Fields default to something
 * deliberately different from `validContractFields()`'s own extracted
 * client, so a test can prove a field the reviewer did not tick to adopt
 * really did stay what was on file, not what the document said. */
async function insertClient(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	overrides: Partial<typeof client.$inferInsert> = {}
) {
	counter += 1;
	const [row] = await tx
		.insert(client)
		.values({
			legalName: `Existing Client ${counter}`,
			taxId: `EXISTING-TAX-${counter}`,
			country: 'IT',
			addressLine1: 'Via Vecchia 1',
			addressCity: 'Brescia',
			addressPostalCode: '25100',
			...overrides
		})
		.returning();
	return row;
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

/** An unclaimed document (#86): no contract, no owner — the shape a
 * first-intake contract PDF is archived under before anything has claimed
 * it. */
async function insertUnclaimedDocument(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const row = await storeDocument(
		{
			bytes: new TextEncoder().encode('%PDF-1.7 fake contract bytes'),
			mime: 'application/pdf',
			originalName: 'contract-a.pdf',
			provenance: 'upload' as const,
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		},
		tx
	);
	return row;
}

/** A well-formed `'contract'` proposal's `proposedFields` (#86), matching
 * `agent/contract-extraction.ts`'s own shape exactly — these tests exercise
 * `repositories/proposal.ts`'s accept dispatcher directly, independent of
 * the producer that would normally build this blob from a model call. */
function validContractFields(
	overrides: {
		clauseFlags?: Record<string, unknown>[];
		contract?: Record<string, unknown>;
		rateCards?: Record<string, unknown>[];
	} = {}
): Record<string, unknown> {
	counter += 1;
	return {
		client: {
			legalName: `Vetraria del Garda ${counter} S.p.A.`,
			taxId: `CONTRACT-TEST-TAX-${counter}`,
			vatId: null,
			country: 'IT',
			addressLine1: 'Via Industriale 8',
			addressLine2: null,
			addressCity: 'Desenzano del Garda',
			addressPostalCode: '25015',
			addressRegion: null
		},
		contract: {
			title: 'Contratto di Consulenza Professionale',
			signedDocumentReference: 'Rep. n. 14/2025',
			startsOn: '2025-09-01',
			endsOn: '2026-08-31',
			renewalType: 'none',
			renewalNoticeDays: null,
			terminationNoticeDays: 45,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'IVA ordinaria 22%',
			requiresPriorApproval: true,
			requiresExpensePreAuthorisation: true,
			expensePolicy: { kind: 'reimbursed_at_cost' },
			...overrides.contract
		},
		rateCards: overrides.rateCards ?? [
			{
				validFrom: '2025-09-01',
				validTo: null,
				kind: 'daily',
				amount: 650,
				unit: 'day',
				allowedFractions: [1, 0.5],
				minimumHours: null,
				disbursementPeriod: null
			}
		],
		clauseFlags: overrides.clauseFlags ?? []
	};
}

/** The `'new'` `ClientChoice` a `validContractFields()` proposal's own
 * extracted client maps onto — the same construction `applyProposal`'s
 * old create-client write did inline, now the reviewer's explicit
 * decision instead of the accept dispatcher's own guess. */
function newClientChoice(extractedClient: Record<string, unknown>): ClientChoice {
	return {
		kind: 'new',
		fields: {
			legalName: extractedClient.legalName as string,
			taxId: extractedClient.taxId as string,
			vatId: extractedClient.vatId as string | null,
			country: extractedClient.country as string,
			addressLine1: extractedClient.addressLine1 as string,
			addressLine2: extractedClient.addressLine2 as string | null,
			addressCity: extractedClient.addressCity as string,
			addressPostalCode: extractedClient.addressPostalCode as string,
			addressRegion: extractedClient.addressRegion as string | null,
			noticeChannel: null,
			sdiCode: null,
			pecAddress: null,
			contacts: []
		}
	};
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

test('listProposalsForDocuments returns every proposal for any document in the batch, and nothing for a document never proposed against or asked for', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await insertDocument(tx, contractRow.id);
		const documentB = await insertDocument(tx, contractRow.id);
		const documentC = await insertDocument(tx, contractRow.id);

		const proposalA = await createProposal(
			{
				documentId: documentA.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				excerpt: 'ok for Monday',
				confidence: 0.9
			},
			tx
		);
		// documentB gets two proposals from the same message — the batch
		// reader must return both, not collapse them.
		const proposalB1 = await createProposal(
			{
				documentId: documentB.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-13', quantity: 1, scope: 'Thursday' },
				excerpt: 'ok for Thursday',
				confidence: 0.9
			},
			tx
		);
		const proposalB2 = await createProposal(
			{
				documentId: documentB.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2024-06-14', quantity: 0.5, scope: 'Friday' },
				excerpt: 'and half of Friday',
				confidence: 0.9
			},
			tx
		);
		// documentC is archived but never proposed against — the batch
		// call for it is exactly the "no row" case a lone
		// `listProposalsForDocument` already returns an empty array for.

		const rows = await listProposalsForDocuments([documentA.id, documentB.id, documentC.id], tx);
		expect(rows.map((row) => row.id).sort()).toEqual(
			[proposalA.id, proposalB1.id, proposalB2.id].sort()
		);

		expect(await listProposalsForDocuments([], tx)).toEqual([]);
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
		expect(created.validationIssue).toMatchObject({
			code: 'must_be_positive',
			field: 'quantity',
			params: { value: -1 }
		});

		const acceptError: unknown = await tx
			.transaction((nested) =>
				acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, nested)
			)
			.catch((error: unknown) => error);
		expect(acceptError).toBeInstanceOf(ProposalValidationError);
		expect((acceptError as ProposalValidationError).issue).toMatchObject({
			code: 'must_be_positive',
			field: 'quantity',
			params: { value: -1 }
		});

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
		expect(created.validationIssue).toMatchObject({
			code: 'must_be_positive',
			field: 'quantity',
			index: null,
			params: { value: 0 }
		});
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

		expect(created.validationIssue).toBeNull();
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
		expect(created.validationIssue).toMatchObject({ code: 'must_be_positive', field: 'quantity' });

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

test('#86: a well-formed first-intake contract proposal has no validation error and no contract_id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields(),
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.85
			},
			tx
		);

		expect(created.validationIssue).toBeNull();
		expect(created.contractId).toBeNull();
	});
});

test('#86: an ambiguous renewal clause with no interpretation chosen blocks silent acceptance', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const flag = {
			field: 'contract.renewalType',
			clauseReference: 'Art. 4 e Art. 9',
			verbatimText: 'si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta',
			readings: [
				'tacit: Art. 4 controls, the contract renews unless notice is given',
				'none: Art. 9 controls, the contract ends on its fixed term'
			],
			interpretationAdopted: null
		};
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields({
					contract: { renewalType: null },
					clauseFlags: [flag]
				}),
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.4
			},
			tx
		);

		// Blocked twice, the same "checked at creation, re-checked at
		// accept" shape #245 already gives work_unit: named at creation...
		expect(created.validationIssue).toMatchObject({ code: 'field_required', field: 'renewalType' });

		// ...and acceptProposal itself refuses it, before any write.
		const acceptError: unknown = await tx
			.transaction((nested) =>
				acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, nested)
			)
			.catch((error: unknown) => error);
		expect(acceptError).toBeInstanceOf(ProposalValidationError);
		expect((acceptError as ProposalValidationError).issue).toMatchObject({
			code: 'field_required',
			field: 'renewalType'
		});

		const stillPending = await getProposal(created.id, tx);
		expect(stillPending?.status).toBe('pending');
		const contracts = await tx
			.select()
			.from(contract)
			.where(eq(contract.title, 'Contratto di Consulenza Professionale'));
		expect(contracts).toHaveLength(0);
	});
});

test('#86: resolving the ambiguous clause with an edit creates the contract and records the reading adopted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const flag = {
			field: 'contract.renewalType',
			clauseReference: 'Art. 4 e Art. 9',
			verbatimText: 'si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta',
			readings: [
				'tacit: Art. 4 controls, the contract renews unless notice is given',
				'none: Art. 9 controls, the contract ends on its fixed term'
			],
			interpretationAdopted: null
		};
		const proposedFields = validContractFields({
			contract: { renewalType: null },
			clauseFlags: [flag]
		});
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields,
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.4
			},
			tx
		);

		const chosenReading =
			'Art. 9 is the later, more specific clause and controls: the contract ends on its fixed term with no renewal.';
		const accepted = await acceptProposal(
			created.id,
			{
				edits: {
					contract: {
						...(proposedFields.contract as Record<string, unknown>),
						renewalType: 'none'
					},
					clauseFlags: [{ ...flag, interpretationAdopted: chosenReading }]
				},
				decidedBy: 'lorenzo@example.com',
				clientChoice: newClientChoice(proposedFields.client as Record<string, unknown>)
			},
			tx
		);

		expect(accepted.status).toBe('accepted');
		expect(accepted.resultId).toBeTruthy();

		const [contractRow] = await tx
			.select()
			.from(contract)
			.where(eq(contract.id, accepted.resultId as string));
		expect(contractRow.renewalType).toBe('none');
		// Active, not draft (#365): `/day/new` offers active contracts only,
		// the day import skips non-active rows, and both contract alerts
		// query `status = 'active'`, so a draft here meant accepting a real
		// signed contract produced one no day could be recorded against and
		// no alert would ever fire for.
		expect(contractRow.status).toBe('active');

		const [clientRow] = await tx.select().from(client).where(eq(client.id, contractRow.clientId));
		expect(clientRow.taxId).toEqual((proposedFields.client as Record<string, unknown>).taxId);

		const cards = await tx.select().from(rateCard).where(eq(rateCard.contractId, contractRow.id));
		expect(cards).toHaveLength(1);
		expect(Number(cards[0].amount)).toBe(650);

		// The clause note is the record issue #86 asks for: the verbatim
		// text and the reading actually adopted, next to each other.
		const notes = await tx
			.select()
			.from(clauseNote)
			.where(eq(clauseNote.contractId, contractRow.id));
		expect(notes).toHaveLength(1);
		expect(notes[0].verbatimText).toBe(flag.verbatimText);
		expect(notes[0].interpretationAdopted).toBe(chosenReading);
		expect(notes[0].clauseReference).toBe('Art. 4 e Art. 9');

		// The founding PDF is claimed by the contract it just produced —
		// no longer unowned.
		const [claimedDocument] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		expect(claimedDocument.contractId).toBe(contractRow.id);
		expect(claimedDocument.ownerType).toBe('contract');
		expect(claimedDocument.ownerId).toBe(contractRow.id);
	});
});

test('#86 (client choice): linking an existing client leaves it untouched when no field is ticked to adopt', async () => {
	await inRolledBackTransaction(async (tx) => {
		const existingClient = await insertClient(tx, {
			legalName: 'Vetraria Storica S.r.l.',
			taxId: 'PRE-EXISTING-TAX-1',
			addressLine1: 'Via Vecchia 1',
			addressCity: 'Brescia',
			addressPostalCode: '25100'
		});
		const documentRow = await insertUnclaimedDocument(tx);
		const fields = validContractFields();
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: fields,
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.9
			},
			tx
		);

		const accepted = await acceptProposal(
			created.id,
			{
				decidedBy: 'lorenzo@example.com',
				clientChoice: { kind: 'existing', clientId: existingClient.id, updates: {} }
			},
			tx
		);

		const [contractRow] = await tx
			.select()
			.from(contract)
			.where(eq(contract.id, accepted.resultId as string));
		expect(contractRow.clientId).toBe(existingClient.id);

		// Every field the document's client differs on (legal name, tax id,
		// the whole address) stays exactly what was on file: no checkbox
		// ticked it, so `applyProposal` never wrote it.
		const [clientAfter] = await tx.select().from(client).where(eq(client.id, existingClient.id));
		expect(clientAfter.legalName).toBe('Vetraria Storica S.r.l.');
		expect(clientAfter.taxId).toBe('PRE-EXISTING-TAX-1');
		expect(clientAfter.addressLine1).toBe('Via Vecchia 1');
		expect(clientAfter.addressCity).toBe('Brescia');
		expect(clientAfter.addressPostalCode).toBe('25100');

		// And no duplicate client materialised under the document's own
		// tax id — the whole point of linking rather than creating.
		const documentTaxId = (fields.client as Record<string, unknown>).taxId as string;
		const clientsWithDocumentTaxId = await tx
			.select()
			.from(client)
			.where(eq(client.taxId, documentTaxId));
		expect(clientsWithDocumentTaxId).toHaveLength(0);
	});
});

test('#86 (client choice): linking an existing client applies only the fields ticked to adopt', async () => {
	await inRolledBackTransaction(async (tx) => {
		const existingClient = await insertClient(tx, {
			legalName: 'Vetraria Storica S.r.l.',
			taxId: 'PRE-EXISTING-TAX-2',
			addressLine1: 'Via Vecchia 2',
			addressCity: 'Brescia',
			addressPostalCode: '25100'
		});
		const documentRow = await insertUnclaimedDocument(tx);
		const fields = validContractFields();
		const documentClient = fields.client as Record<string, unknown>;
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: fields,
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.9
			},
			tx
		);

		const accepted = await acceptProposal(
			created.id,
			{
				decidedBy: 'lorenzo@example.com',
				clientChoice: {
					kind: 'existing',
					clientId: existingClient.id,
					// Only the registered address is ticked to adopt — the
					// legal name and tax id also differ but stay what is on
					// file, proving the choice is per field, not all-or-none.
					updates: {
						addressLine1: documentClient.addressLine1 as string,
						addressCity: documentClient.addressCity as string
					}
				}
			},
			tx
		);

		const [contractRow] = await tx
			.select()
			.from(contract)
			.where(eq(contract.id, accepted.resultId as string));
		expect(contractRow.clientId).toBe(existingClient.id);

		const [clientAfter] = await tx.select().from(client).where(eq(client.id, existingClient.id));
		expect(clientAfter.addressLine1).toBe(documentClient.addressLine1);
		expect(clientAfter.addressCity).toBe(documentClient.addressCity);
		expect(clientAfter.legalName).toBe('Vetraria Storica S.r.l.');
		expect(clientAfter.taxId).toBe('PRE-EXISTING-TAX-2');
		expect(clientAfter.addressPostalCode).toBe('25100');
	});
});

test('#86 (client choice): creating a new client writes exactly the fields chosen', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const fields = validContractFields();
		const documentClient = fields.client as Record<string, unknown>;
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: fields,
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.9
			},
			tx
		);

		const accepted = await acceptProposal(
			created.id,
			{ decidedBy: 'lorenzo@example.com', clientChoice: newClientChoice(documentClient) },
			tx
		);

		const [contractRow] = await tx
			.select()
			.from(contract)
			.where(eq(contract.id, accepted.resultId as string));
		const [clientRow] = await tx.select().from(client).where(eq(client.id, contractRow.clientId));
		expect(clientRow.legalName).toBe(documentClient.legalName);
		expect(clientRow.taxId).toBe(documentClient.taxId);
		expect(clientRow.addressLine1).toBe(documentClient.addressLine1);
		expect(clientRow.noticeChannel).toBeNull();
	});
});

test('#86: an ambiguous clause flag whose verbatimText the excerpt does not carry still round-trips through accept unedited when interpretationAdopted is supplied', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const flag = {
			field: 'rateCards.0.disbursementPeriod',
			clauseReference: 'Art. 2',
			verbatimText: 'un minimo fatturabile di 2 ore per singolo intervento',
			readings: ['solo ore intere', 'frazioni orarie ammesse'],
			interpretationAdopted: 'solo ore intere, come da lettura pi\u00f9 conservativa'
		};
		const proposedFields = validContractFields({ clauseFlags: [flag] });
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields,
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.7
			},
			tx
		);
		// Already resolved as proposed (interpretationAdopted set by the
		// producer's own edit-free path is unrealistic, but this proves the
		// gate is exactly "interpretationAdopted present", not tied to
		// whether contract.renewalType specifically is null.
		expect(created.validationIssue).toBeNull();

		const accepted = await acceptProposal(
			created.id,
			{
				decidedBy: 'lorenzo@example.com',
				clientChoice: newClientChoice(proposedFields.client as Record<string, unknown>)
			},
			tx
		);
		const notes = await tx
			.select()
			.from(clauseNote)
			.where(eq(clauseNote.contractId, accepted.resultId as string));
		expect(notes).toHaveLength(1);
		expect(notes[0].interpretationAdopted).toBe(flag.interpretationAdopted);
	});
});

// #245: structured coverage for the shapes review screens depend on
// most, one per representative code — asserted on `{ code, field, index }`
// and `params`, never on a rendered sentence, so a translation on the
// interface side can never again desynchronise from what the server
// actually found wrong (the Italian-review-screen incident this whole
// module replaces the string-based version for).
test('an invoice line with taxRate 120 is out of range, structured by field and index', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				proposedFields: {
					number: 'INV-2026-014',
					issueDate: '2026-03-04',
					dueDate: '2026-04-03',
					clientName: 'Acme SRL',
					currency: 'EUR',
					lines: [
						{
							description: 'Consulenza marzo 2026',
							quantity: 1,
							unitPrice: 60000,
							amount: 60000,
							taxRate: 120
						}
					],
					taxableAmount: 60000,
					taxAmount: 0,
					total: 60000
				},
				excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
				confidence: 0.7
			},
			tx
		);

		expect(created.validationIssue).toMatchObject({
			code: 'out_of_range',
			field: 'taxRate',
			index: 0,
			params: { value: 120, min: 0, max: 100 }
		});
	});
});

test('the live incident: renewalType explicit with no renewalNoticeDays names the field structurally', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields({
					contract: { renewalType: 'explicit', renewalNoticeDays: null }
				}),
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.6
			},
			tx
		);

		expect(created.validationIssue).toMatchObject({
			code: 'renewal_notice_required',
			field: 'renewalNoticeDays',
			index: null,
			params: { renewalType: 'explicit' }
		});
	});
});

test('two overlapping rate cards are flagged by their own indices, not a rendered sentence', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields({
					rateCards: [
						{
							validFrom: '2025-01-01',
							validTo: '2025-12-31',
							kind: 'daily',
							amount: 650,
							unit: 'day',
							allowedFractions: [1],
							minimumHours: null,
							disbursementPeriod: null
						},
						{
							validFrom: '2025-06-01',
							validTo: null,
							kind: 'daily',
							amount: 700,
							unit: 'day',
							allowedFractions: [1],
							minimumHours: null,
							disbursementPeriod: null
						}
					]
				}),
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.6
			},
			tx
		);

		expect(created.validationIssue).toMatchObject({
			code: 'overlapping_validity',
			field: null,
			index: null,
			params: { first: 0, second: 1 }
		});
	});
});

test('a clause flag with no interpretation chosen blocks acceptance on its own, independent of every other field', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const flag = {
			field: 'rateCards.0.disbursementPeriod',
			clauseReference: 'Art. 2',
			verbatimText: 'un minimo fatturabile di 2 ore per singolo intervento',
			readings: ['solo ore intere', 'frazioni orarie ammesse'],
			interpretationAdopted: null
		};

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields({ clauseFlags: [flag] }),
				excerpt: 'tra Vetraria del Garda S.p.A. e dott. Elia Fontana',
				confidence: 0.7
			},
			tx
		);

		expect(created.validationIssue).toMatchObject({
			code: 'interpretation_required',
			field: null,
			index: null,
			params: { clause: 'Art. 2', field: 'rateCards.0.disbursementPeriod' }
		});
	});
});

// The tab badge reads this on every tab, not only the pending one: the
// count used to be computed on the pending branch alone, so it vanished
// the moment a reviewer looked at Accepted — which is exactly when they
// want to know whether anything new arrived.
test('countPendingProposals counts only what is still waiting on a human', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const before = await countPendingProposals(tx);

		const fields = {
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'work_unit' as const,
			proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
			excerpt: 'ok for Monday',
			confidence: 0.9
		};
		await createProposal(fields, tx);
		const second = await createProposal(fields, tx);
		expect(await countPendingProposals(tx)).toBe(before + 2);

		await rejectProposal(second.id, 'human', tx);
		expect(await countPendingProposals(tx)).toBe(before + 1);
	});
});
