// #218's acceptance, proved two ways: `manualSendPeriod` is a pure
// function over an invoice's own lines, unit-tested directly; `
// buildManualSendContext` is proved against a real, persisted invoice —
// not a hand-typed fixture — seeded the same way `send.test.ts` seeds
// one (a real approval, a real billed day, a real invoice line linking
// it), so the period and the day register it renders come off exactly
// what a human picking this invoice on the compose screen would see.
import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { client as pool, db } from '$lib/server/db';
import { client, contract, invoice, invoiceLine, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from '$lib/server/repositories/approval';
import { getInvoiceWithLines } from '$lib/server/repositories/invoice';
import { createWorkUnit } from '$lib/server/repositories/work-unit';
import { buildManualSendContext, manualSendPeriod } from './compose';

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

test('an invoice with no linked days collapses the period to its own issue date', () => {
	expect(manualSendPeriod({ issueDate: '2024-03-31', lines: [] })).toEqual({
		from: '2024-03-31',
		to: '2024-03-31'
	});
	expect(
		manualSendPeriod({ issueDate: '2024-03-31', lines: [{ days: [] }, { days: [] }] })
	).toEqual({ from: '2024-03-31', to: '2024-03-31' });
});

test('an invoice with linked days spans its earliest to its latest, across lines', () => {
	const period = manualSendPeriod({
		issueDate: '2024-03-31',
		lines: [
			{ days: [{ date: '2024-03-12' }, { date: '2024-03-05' }] },
			{ days: [{ date: '2024-03-28' }] }
		]
	});
	expect(period).toEqual({ from: '2024-03-05', to: '2024-03-28' });
});

async function seedInvoiceWithOneBilledDay(tx: Tx) {
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

	const bytes = new TextEncoder().encode('Yes, go ahead.');
	const approvalRow = await createApproval(
		{
			contractId: contractRow.id,
			channel: 'email',
			sender: 'ops@client.example',
			receivedAt: new Date('2024-03-01T09:00:00Z'),
			messageId: '<abc@example.com>',
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
	const day = await createWorkUnit(
		{
			contractId: contractRow.id,
			date: '2024-03-14',
			quantity: 1,
			scope: 'Compose-context fixture day.',
			approvalId: approvalRow.id
		},
		{ kind: 'human', email: 'lorenzo@example.com' },
		'seed',
		tx
	);

	const [invoiceRow] = await tx
		.insert(invoice)
		.values({
			contractId: contractRow.id,
			number: `INV-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2024-03-31',
			currency: 'EUR',
			taxableAmount: minorUnits(100_000),
			taxAmount: minorUnits(22_000),
			total: minorUnits(122_000),
			dueDate: '2024-04-30',
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
	await tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, day.id));
	await tx.update(workUnit).set({ state: 'worked' }).where(eq(workUnit.id, day.id));
	await tx
		.update(workUnit)
		.set({ state: 'invoiced', invoiceLineId: lineRow.id })
		.where(eq(workUnit.id, day.id));

	const rehydrated = await getInvoiceWithLines(invoiceRow.id, tx);
	if (!rehydrated) throw new Error('invoice failed to persist');
	return { contractRow, invoiceRow: rehydrated };
}

test('builds a cover-note context off a real invoice: the period and register come off its own billed day, not a typed range', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { invoiceRow } = await seedInvoiceWithOneBilledDay(tx);

		const context = await buildManualSendContext(invoiceRow, 'en', tx);

		expect(context.period).toEqual({ from: '2024-03-14', to: '2024-03-14' });
		expect(context.invoice.number).toBe(invoiceRow.number);
		expect(context.invoice.total).toBe(invoiceRow.total);
		expect(context.invoice.dueDate).toBe('2024-04-30');
		expect(context.register.entries).toHaveLength(1);
		expect(context.register.entries[0].date).toBe('2024-03-14');
	});
});
