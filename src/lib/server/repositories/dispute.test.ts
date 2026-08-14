import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { rejection } from '$lib/server/db/pg-error';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { minorUnits } from '$lib/money';
import { createApproval } from './approval';
import { createInvoice } from './invoice';
import {
	createWorkUnit,
	disputeWorkUnit,
	getWorkUnitInvoiceLine,
	listWorkUnitTransitions,
	resolveWorkUnitDispute,
	transitionWorkUnit
} from './work-unit';

// #214. Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// transaction-rollback pattern as `worked-without-approval.test.ts`;
// `createApproval` writes a document to disk, so `DOCUMENT_STORAGE_ROOT`
// points at a throwaway temp directory removed in `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-dispute-'));
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

async function insertContract(tx: Tx) {
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
			requiresPriorApproval: true
		})
		.returning();
	return contractRow;
}

const LORENZO = { kind: 'human', email: 'lorenzo@example.com' } as const;

async function insertInvoicedDay(tx: Tx, contractId: string) {
	const approval = await createApproval(
		{
			contractId,
			channel: 'email',
			sender: 'ops@client.example',
			receivedAt: new Date('2026-06-01T09:00:00Z'),
			messageId: '<approval@client.example>',
			excerpt: 'Yes, go ahead.',
			origin: { kind: 'manual' },
			document: {
				bytes: new TextEncoder().encode('Yes, go ahead.'),
				mime: 'message/rfc822',
				originalName: 'approval.eml',
				provenance: 'mail',
				confidential: true
			}
		},
		tx
	);
	const day = await createWorkUnit(
		{
			contractId,
			date: '2026-06-01',
			quantity: 1,
			scope: 'Audit scorte trimestrale',
			state: 'worked',
			approvalId: approval.id
		},
		LORENZO,
		'giornata svolta come da approvazione',
		tx
	);
	await createInvoice(
		{
			contractId,
			number: `DISP-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2026-06-05',
			documentType: 'invoice',
			currency: 'EUR',
			taxTreatmentCode: null,
			statutoryReference: null,
			stampDuty: null,
			socialCharge: null,
			dueDate: null,
			paymentMethod: null,
			iban: null,
			transmissionId: null,
			lines: [
				{
					description: 'Audit scorte trimestrale — 01/06/2026',
					quantity: 1,
					unitPrice: minorUnits(70000),
					amount: minorUnits(70000),
					taxRate: 22,
					taxTreatmentCode: null,
					workUnitIds: [day.id]
				}
			]
		},
		LORENZO,
		'issued',
		tx
	);
	return day;
}

test('#214: an invoiced day can be disputed and resolved, each transition recording its own reason', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const day = await insertInvoicedDay(tx, contractRow.id);

		const disputed = await disputeWorkUnit(
			day.id,
			LORENZO,
			'il cliente contesta la quantità fatturata',
			tx
		);
		expect(disputed.state).toBe('disputed');

		// The way in never drops the day off its invoice line — a dispute
		// contests the bill, it does not undo it (AGENTS.md's own framing:
		// the register still names a disputed day's approval because it
		// "was invoiced, then disputed").
		const stillOnLine = await getWorkUnitInvoiceLine(day.id, tx);
		expect(stillOnLine).not.toBeNull();

		const resolved = await resolveWorkUnitDispute(
			day.id,
			LORENZO,
			'chiarito con il cliente: quantità confermata',
			tx
		);
		expect(resolved.state).toBe('invoiced');

		const log = await listWorkUnitTransitions(day.id, tx);
		const disputedEntry = log.find((t) => t.toState === 'disputed');
		const resolvedEntry = log.findLast((t) => t.toState === 'invoiced');

		expect(disputedEntry?.fromState).toBe('invoiced');
		expect(disputedEntry?.reason).toBe('il cliente contesta la quantità fatturata');
		expect(disputedEntry?.actor).toEqual(LORENZO);

		expect(resolvedEntry?.fromState).toBe('disputed');
		expect(resolvedEntry?.reason).toBe('chiarito con il cliente: quantità confermata');
		expect(resolvedEntry?.actor).toEqual(LORENZO);
	});
});

test('#214: a day that was never invoiced cannot be disputed — the database rejects the edge, not just the UI', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const approval = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'ops@client.example',
				receivedAt: new Date('2026-06-01T09:00:00Z'),
				messageId: '<approval2@client.example>',
				excerpt: 'Yes, go ahead.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Yes, go ahead.'),
					mime: 'message/rfc822',
					originalName: 'approval2.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-06-02',
				quantity: 1,
				scope: 'Not billed yet',
				state: 'worked',
				approvalId: approval.id
			},
			LORENZO,
			'giornata svolta',
			tx
		);

		const error = await rejection(() => disputeWorkUnit(day.id, LORENZO, 'too early', tx), tx);
		expect(error.message).toContain('illegal work_unit transition');
	});
});

test('#214: a paid day cannot be disputed — the trigger only admits the edge from `invoiced`, not `paid`', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const day = await insertInvoicedDay(tx, contractRow.id);
		const paid = await transitionWorkUnit(
			day.id,
			{ state: 'paid' },
			LORENZO,
			'incasso registrato',
			tx
		);
		expect(paid.state).toBe('paid');

		const error = await rejection(
			() => disputeWorkUnit(day.id, LORENZO, 'too late, already collected', tx),
			tx
		);
		expect(error.message).toContain('illegal work_unit transition');
	});
});
