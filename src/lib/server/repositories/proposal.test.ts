import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, workUnit } from '$lib/server/db/schema';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	acceptProposal,
	createProposal,
	diffProposalFields,
	getProposal,
	rejectProposal
} from './proposal';
import { createWorkUnit } from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/work-unit.test.ts`. `document` rows are inserted directly,
// not through `storeDocument`, since none of this exercises the blob store
// — the same shortcut `db/schema/work-unit.test.ts`'s `insertApproval`
// helper takes.
//
// The "no bypass" tests (#83's acceptance) call `acceptProposal` inside its
// own nested transaction (a real Postgres SAVEPOINT — see
// `postgres-js/session.ts`), so a rejected write rolls back only that
// nested transaction and the outer, rolled-back-at-the-end test
// transaction stays usable afterwards to prove the proposal was left
// exactly as it was.

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

async function insertDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const [row] = await tx
		.insert(document)
		.values({
			hash: 'f'.repeat(64),
			mime: 'message/rfc822',
			size: 256,
			originalName: 'approval.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		})
		.returning();
	return row;
}

afterAll(async () => {
	await pool.end();
});

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

test('accepting a proposal exactly as proposed writes a work_unit through the normal repository, with no diff', async () => {
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
		// Accepting a proposal records the day; it does not also approve
		// it (#81's note on #85) — that is still a separate step.
		expect(workUnitRow.state).toBe('proposed');
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

test('rejecting a proposal records the decision and writes nothing to work_unit', async () => {
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

test('#83 no bypass: an invalid quantity is rejected by the same constraint a manual entry would trip, leaving the proposal pending', async () => {
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
				// slip past `work_unit_quantity_positive`.
				proposedFields: { date: '2024-06-10', quantity: -1, scope: 'API migration' },
				excerpt: 'ok for Monday, apparently for a negative amount of it',
				confidence: 0.4
			},
			tx
		);

		await expect(
			tx.transaction((nested) =>
				acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, nested)
			)
		).rejects.toSatisfy((error) =>
			isPostgresConstraintViolation(error, '23514', 'work_unit_quantity_positive')
		);

		const stillPending = await getProposal(created.id, tx);
		expect(stillPending?.status).toBe('pending');
		expect(stillPending?.acceptedFields).toBeNull();

		const rows = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractRow.id));
		expect(rows).toHaveLength(0);
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
