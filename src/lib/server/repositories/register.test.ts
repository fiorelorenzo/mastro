import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, invoice, invoiceLine, workUnit } from '$lib/server/db/schema';
import { minorUnits } from '$lib/money';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';
import { createApproval } from './approval';
import { createWorkUnit } from './work-unit';
import { buildRegister } from './register';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// transaction-rollback pattern as `work-unit.test.ts`; `createApproval`
// writes a document to disk, so `DOCUMENT_STORAGE_ROOT` points at a
// throwaway temp directory removed in `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-register-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertContract(tx: Tx, requiresPriorApproval: boolean) {
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

async function insertApproval(tx: Tx, contractId: string, sender: string) {
	const bytes = new TextEncoder().encode(`Yes, go ahead — ${sender}`);
	return createApproval(
		{
			contractId,
			channel: 'email',
			sender,
			receivedAt: new Date('2024-03-01T09:00:00Z'),
			messageId: `<${crypto.randomUUID()}@example.com>`,
			excerpt: 'Yes, go ahead.',
			origin: { kind: 'manual' },
			document: {
				bytes,
				mime: 'message/rfc822',
				originalName: 'approval.eml',
				provenance: 'mail',
				confidential: true
			}
		},
		tx
	);
}

/**
 * Walks a day to `state` for the register to read back, one legal edge at a
 * time, because the state machine (`drizzle/0012`) has no shortcut and no
 * INSERT may start past `worked`.
 *
 * `invoiced` and beyond need a real `invoice_line`: that column has had a
 * foreign key since #26, so the uuid this helper used to invent was never
 * going to satisfy it. This creates the invoice and the line the day is
 * billed on, which is also what the register is meant to be reading.
 */
async function forceState(tx: Tx, workUnitId: string, contractId: string, state: WorkUnitState) {
	const needsInvoiceLine = state === 'invoiced' || state === 'paid' || state === 'disputed';

	// A day created without an approval starts at `worked_without_approval`
	// and reaches `worked` directly; one created with an approval starts at
	// `proposed` and goes through `approved`. Both are legal edges, and
	// which one applies depends on the row, not on the caller.
	const [before] = await tx.select().from(workUnit).where(eq(workUnit.id, workUnitId));
	if (before.state === 'proposed') {
		await tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, workUnitId));
	}
	if (before.state !== 'worked') {
		await tx.update(workUnit).set({ state: 'worked' }).where(eq(workUnit.id, workUnitId));
	}
	if (state === 'worked') return;

	if (needsInvoiceLine) {
		const [invoiceRow] = await tx
			.insert(invoice)
			.values({
				contractId,
				number: `REG-${crypto.randomUUID().slice(0, 8)}`,
				issueDate: '2026-02-28',
				currency: 'EUR',
				taxableAmount: minorUnits(100_000),
				taxAmount: minorUnits(22_000),
				total: minorUnits(122_000),
				dueDate: '2026-03-30',
				dueDateSource: 'computed'
			})
			.returning();
		const [lineRow] = await tx
			.insert(invoiceLine)
			.values({
				invoiceId: invoiceRow.id,
				description: 'Days',
				quantity: 1,
				unitPrice: minorUnits(100_000),
				amount: minorUnits(100_000),
				taxRate: 22
			})
			.returning();
		await tx
			.update(workUnit)
			.set({ state: 'invoiced', invoiceLineId: lineRow.id })
			.where(eq(workUnit.id, workUnitId));
	}
	if (state !== 'invoiced') {
		await tx.update(workUnit).set({ state }).where(eq(workUnit.id, workUnitId));
	}
}

test('the register carries every billed day in the period with its approval reference and totals, in date order', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const approvalRow = await insertApproval(tx, contractRow.id, 'ops@client.example');

		const inPeriodLater = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-03-20',
				quantity: 1,
				scope: 'Later day in period.',
				approvalId: approvalRow.id
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		const inPeriodEarlier = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-03-05',
				quantity: 0.5,
				scope: 'Earlier half day in period.',
				approvalId: approvalRow.id
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		const outsidePeriod = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-04-01',
				quantity: 1,
				scope: 'Outside the requested period.',
				approvalId: approvalRow.id
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		const stillWorked = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-03-10',
				quantity: 1,
				scope: 'Worked but not yet invoiced.',
				approvalId: approvalRow.id,
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);

		await forceState(tx, inPeriodLater.id, contractRow.id, 'invoiced');
		await forceState(tx, inPeriodEarlier.id, contractRow.id, 'paid');
		await forceState(tx, outsidePeriod.id, contractRow.id, 'invoiced');
		// stillWorked stays 'worked': never billed, must not appear.

		const register = await buildRegister(contractRow.id, '2024-03-01', '2024-03-31', tx);

		expect(register.entries.map((e) => e.workUnitId)).toEqual([
			inPeriodEarlier.id,
			inPeriodLater.id
		]);
		expect(register.entries[0].date).toBe('2024-03-05');
		expect(register.entries[0].scope).toBe('Earlier half day in period.');
		expect(register.entries[0].approval.sender).toBe('ops@client.example');
		expect(register.entries[0].approval.channel).toBe('email');
		expect(register.entries[0].approval.messageId).toBeTruthy();
		expect(register.totalQuantity).toBe(1.5);

		void stillWorked;
	});
});

test('a disputed day (invoiced, then disputed) still counts as billed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const approvalRow = await insertApproval(tx, contractRow.id, 'ops@client.example');
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-15',
				quantity: 1,
				scope: 'Disputed day.',
				approvalId: approvalRow.id
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		await forceState(tx, day.id, contractRow.id, 'disputed');

		const register = await buildRegister(contractRow.id, '2024-06-01', '2024-06-30', tx);
		expect(register.entries.map((e) => e.workUnitId)).toEqual([day.id]);
	});
});

test('a billed day with no approval on file is excluded, not emitted with a blank reference', async () => {
	await inRolledBackTransaction(async (tx) => {
		// requires_prior_approval = false: the state machine trigger
		// allows 'worked' -> 'invoiced' with approval_id left null.
		const contractRow = await insertContract(tx, false);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-07-10',
				quantity: 1,
				scope: 'Billed with no approval on file.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		await forceState(tx, day.id, contractRow.id, 'invoiced');

		const register = await buildRegister(contractRow.id, '2024-07-01', '2024-07-31', tx);
		expect(register.entries).toEqual([]);
		expect(register.totalQuantity).toBe(0);
	});
});

test('a day billed on another contract never leaks into this one', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx, true);
		const contractB = await insertContract(tx, true);
		const approvalB = await insertApproval(tx, contractB.id, 'ops@other.example');

		const dayB = await createWorkUnit(
			{
				contractId: contractB.id,
				date: '2024-08-05',
				quantity: 1,
				scope: 'Belongs to contract B.',
				approvalId: approvalB.id
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'seed',
			tx
		);
		await forceState(tx, dayB.id, contractB.id, 'invoiced');

		const registerA = await buildRegister(contractA.id, '2024-08-01', '2024-08-31', tx);
		expect(registerA.entries).toEqual([]);
	});
});
