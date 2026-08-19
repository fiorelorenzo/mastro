// The bug: `invoice_contract_number_unique` (the per-contract constraint
// `0014_invoice.sql` first shipped) was renamed to `invoice_number_unique`
// by `0048_invoice_number_unique.sql` (#257 — numbering is unique across
// the whole ledger, not per contract), but this route's own duplicate-number
// catch kept checking the old, now-nonexistent name. The database still
// rejected the second insert correctly; the route just never recognised
// why, so `catch` fell through to `throw error` and the operator got an
// unhandled 500 instead of the friendly `invoice_validation_number_duplicate`
// message next to the field they typed it into.
//
// This exercises the actual form `action`, not just the repository, since
// the repository-level constraint (`invoice.test.ts`'s own "#257" test)
// already passed throughout — the defect was entirely in which name the
// route matched on, invisible to any test that never went through it.
//
// The action always writes through the shared `db` singleton (every helper
// it calls defaults its executor to `db`, and it never receives a `tx`), so
// unlike the rolled-back-transaction suite, this really commits — against
// the same seeded database five other agents are using — and cleans up
// exactly the rows it created, in FK order (`invoice` before `contract`
// before `client`; invoice_line cascades with its invoice).
import { afterAll, expect, test } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as m from '$lib/paraglide/messages';
import { client as pool, db } from '$lib/server/db';
import { postgresErrorFrom } from '$lib/server/db/pg-error';
import { client, contract, invoice } from '$lib/server/db/schema';
import { createInvoice } from '$lib/server/repositories/invoice';
import { minorUnits } from '$lib/money';
import { actions } from './+page.server';

afterAll(async () => {
	await pool.end();
});

function submissionFormData(contractId: string, number: string): FormData {
	const data = new FormData();
	data.set('contractId', contractId);
	data.set('number', number);
	// Well before the demo seed's fiscal profile (`validFrom: '2024-01-01'`,
	// AGENTS.md: one fiscal profile), so `resolveActiveFiscalPack` resolves
	// to no active pack and the action takes the manual-tax branch — the
	// smallest submission that never depends on which packs are seeded.
	data.set('issueDate', '1999-01-01');
	data.set('documentType', 'invoice');
	data.set('currency', 'EUR');
	data.set('manualLineDescription', 'Regression fixture line');
	data.set('manualLineAmount', '100.00');
	data.set('taxRate', '0');
	return data;
}

// Only `request` and `locals.user.email` are read by `actions.default`
// (see `+page.server.ts`); everything else `RequestEvent` carries is unused
// by this action, so a narrow, cast object stands in for the framework
// event SvelteKit would normally construct per request.
function actionEvent(formData: FormData) {
	return {
		request: new Request('http://localhost/invoices/new', { method: 'POST', body: formData }),
		locals: { user: { email: 'lorenzo@example.com' } }
	} as unknown as Parameters<typeof actions.default>[0];
}

test('a duplicate invoice number returns the friendly validation error, not a 500 — the route matches the constraint the database actually enforces', async () => {
	const [clientRow] = await db
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
	const [contractRow] = await db
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '1998-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' },
			requiresPriorApproval: false
		})
		.returning();

	const number = `INV-322-${crypto.randomUUID().slice(0, 8)}`;
	let invoiceId: string | null = null;

	try {
		// First submission: succeeds and redirects to the new invoice.
		let firstError: unknown;
		try {
			await actions.default(actionEvent(submissionFormData(contractRow.id, number)));
		} catch (error) {
			firstError = error;
		}
		expect(isRedirect(firstError)).toBe(true);

		const [createdRow] = await db
			.select({ id: invoice.id })
			.from(invoice)
			.where(eq(invoice.number, number));
		expect(createdRow).toBeDefined();
		invoiceId = createdRow.id;

		// Second submission, same number: the database rejects it exactly
		// the way `invoice.test.ts`'s "#257" test already proves — confirmed
		// directly here too, so this test fails on its own if the constraint
		// this route is supposed to recognise ever changes name again.
		const rawError = await createInvoice(
			{
				contractId: contractRow.id,
				number,
				issueDate: '1999-01-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '1999-01-31',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Duplicate-number probe',
						quantity: 1,
						unitPrice: minorUnits(10000),
						amount: minorUnits(10000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture'
		).catch((error: unknown) => error);
		expect(postgresErrorFrom(rawError)).toMatchObject({
			code: '23505',
			constraint_name: 'invoice_number_unique'
		});

		// The route action, hit with the same duplicate through the actual
		// form path: a friendly `fail`, never a thrown 500.
		const secondResult = await actions.default(
			actionEvent(submissionFormData(contractRow.id, number))
		);
		expect(secondResult).toMatchObject({
			status: 400,
			data: { errors: { number: m.invoice_validation_number_duplicate() } }
		});
	} finally {
		if (invoiceId) await db.delete(invoice).where(eq(invoice.id, invoiceId));
		await db.delete(contract).where(eq(contract.id, contractRow.id));
		await db.delete(client).where(eq(client.id, clientRow.id));
	}
});
