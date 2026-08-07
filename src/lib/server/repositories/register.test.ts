import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
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

/** Drives a day straight to `state` for the register to read back,
 * bypassing `transitionWorkUnit`'s narrower `WorkUnitInput` (it has no
 * `invoiceLineId`, out of scope for #70): `invoice_line_id` has no foreign
 * key yet (#26), so any UUID satisfies the
 * `work_unit_invoiced_or_paid_has_invoice_line` CHECK the state machine
 * requires for `invoiced`/`paid`/`disputed`. */
async function forceState(tx: Tx, workUnitId: string, state: WorkUnitState) {
	const needsInvoiceLine = state === 'invoiced' || state === 'paid' || state === 'disputed';
	if (needsInvoiceLine) {
		await tx
			.update(workUnit)
			.set({ state: 'invoiced', invoiceLineId: crypto.randomUUID() })
			.where(eq(workUnit.id, workUnitId));
	}
	if (state !== 'invoiced') {
		await tx.update(workUnit).set({ state }).where(eq(workUnit.id, workUnitId));
	}
}

test('the register carries every billed day in the period with its approval reference and totals, in date order', async () => {
	await expect(
		db.transaction(async (tx) => {
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

			await forceState(tx, inPeriodLater.id, 'invoiced');
			await forceState(tx, inPeriodEarlier.id, 'paid');
			await forceState(tx, outsidePeriod.id, 'invoiced');
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
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a disputed day (invoiced, then disputed) still counts as billed', async () => {
	await expect(
		db.transaction(async (tx) => {
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
			await forceState(tx, day.id, 'disputed');

			const register = await buildRegister(contractRow.id, '2024-06-01', '2024-06-30', tx);
			expect(register.entries.map((e) => e.workUnitId)).toEqual([day.id]);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a billed day with no approval on file is excluded, not emitted with a blank reference', async () => {
	await expect(
		db.transaction(async (tx) => {
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
			await forceState(tx, day.id, 'invoiced');

			const register = await buildRegister(contractRow.id, '2024-07-01', '2024-07-31', tx);
			expect(register.entries).toEqual([]);
			expect(register.totalQuantity).toBe(0);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a day billed on another contract never leaks into this one', async () => {
	await expect(
		db.transaction(async (tx) => {
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
			await forceState(tx, dayB.id, 'invoiced');

			const registerA = await buildRegister(contractA.id, '2024-08-01', '2024-08-31', tx);
			expect(registerA.entries).toEqual([]);

			tx.rollback();
		})
	).rejects.toThrow();
});
