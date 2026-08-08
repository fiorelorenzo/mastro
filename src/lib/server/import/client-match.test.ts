// #46. `matchClientByTaxId` and `buildClientContractProposal` are pure —
// tested the same way `direction.test.ts` tests direction detection, with
// hand-built `Invoice` values rather than through an adapter.
import { expect, test } from 'vitest';
import { minorUnits, NO_MINOR_UNITS } from '$lib/money';
import {
	buildClientContractProposal,
	inferInvoicingCadence,
	matchClientByTaxId,
	type ClientMatchCandidate
} from './client-match';
import type { Invoice, InvoiceParty } from './invoice';

function party(overrides: Partial<InvoiceParty> = {}): InvoiceParty {
	return {
		legalName: 'Rossi Consulting srl',
		taxId: 'IT01234567890',
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		...overrides
	};
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
	return {
		number: '2024/1',
		issueDate: '2024-01-15',
		documentType: 'invoice',
		currency: 'EUR',
		supplier: party({ taxId: 'IT11111111111', legalName: 'Consultant' }),
		customer: party(),
		lines: [],
		taxSummary: [
			{ taxRate: 0.22, taxableAmount: minorUnits(100000), taxAmount: minorUnits(22000) }
		],
		taxableAmount: minorUnits(100000),
		taxAmount: minorUnits(22000),
		total: minorUnits(122000),
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: 'IT11111111111', progressiveNumber: '1' },
		...overrides
	};
}

test('matchClientByTaxId finds an exact match, ignoring case and whitespace', () => {
	const clients: ClientMatchCandidate[] = [
		{
			id: 'client-1',
			taxId: ' it01234567890 ',
			legalName: 'Rossi Consulting srl',
			activeContractId: 'contract-1'
		}
	];
	expect(matchClientByTaxId({ taxId: 'IT01234567890' }, clients)).toEqual(clients[0]);
});

test('matchClientByTaxId returns null when no client has this tax id', () => {
	const clients: ClientMatchCandidate[] = [
		{ id: 'client-1', taxId: 'IT09876543210', legalName: 'Bianchi spa', activeContractId: null }
	];
	expect(matchClientByTaxId({ taxId: 'IT01234567890' }, clients)).toBeNull();
});

test('inferInvoicingCadence proposes on_completion for a single invoice', () => {
	expect(inferInvoicingCadence(['2024-01-15'])).toBe('on_completion');
});

test('inferInvoicingCadence recognises a roughly monthly rhythm', () => {
	expect(inferInvoicingCadence(['2024-01-01', '2024-02-01', '2024-03-03'])).toBe('monthly');
});

test('inferInvoicingCadence recognises a roughly quarterly rhythm', () => {
	expect(inferInvoicingCadence(['2024-01-01', '2024-04-02', '2024-07-01'])).toBe('quarterly');
});

test('inferInvoicingCadence recognises a roughly annual rhythm', () => {
	expect(inferInvoicingCadence(['2022-01-01', '2023-01-05', '2024-01-02'])).toBe('annual');
});

test('buildClientContractProposal copies the customer party onto the client proposal', () => {
	const proposal = buildClientContractProposal([invoice()]);
	expect(proposal.client).toEqual({
		legalName: 'Rossi Consulting srl',
		taxId: 'IT01234567890',
		vatId: null,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressLine2: null,
		addressCity: 'Milano',
		addressPostalCode: '20100',
		addressRegion: null,
		noticeChannel: 'email'
	});
});

test('buildClientContractProposal defaults a safe, non-committal contract shape', () => {
	const proposal = buildClientContractProposal([invoice()]);
	expect(proposal.contract).toMatchObject({
		title: 'Rossi Consulting srl',
		startsOn: '2024-01-15',
		endsOn: null,
		renewalType: 'none',
		renewalNoticeDays: null,
		invoicingCadence: 'on_completion',
		currency: 'EUR',
		terminationNoticeDays: 0,
		requiresPriorApproval: false,
		expensePolicy: { kind: 'not_reimbursed' },
		status: 'active'
	});
});

test('a single invoice with no payment-terms block falls back to net 30', () => {
	const proposal = buildClientContractProposal([invoice({ paymentTerms: [] })]);
	expect(proposal.contract.paymentTerms).toEqual({ kind: 'net', days: 30 });
});

test('the payment terms are read from the invoice\u2019s own first instalment', () => {
	const withTerms = invoice({
		paymentTerms: [
			{
				conditionCode: 'TP02',
				installments: [
					{
						dueDate: '2024-02-04',
						dueDateSource: 'document',
						amount: minorUnits(122000),
						method: 'MP05'
					}
				]
			}
		]
	});
	expect(buildClientContractProposal([withTerms]).contract.paymentTerms).toEqual({
		kind: 'net',
		days: 20
	});
});

test('taxTreatment is copied verbatim from the invoice when present, else left blank', () => {
	const withCode = invoice({
		taxSummary: [
			{
				taxRate: 0,
				taxTreatmentCode: 'N2.2',
				taxableAmount: minorUnits(100000),
				taxAmount: NO_MINOR_UNITS
			}
		]
	});
	expect(buildClientContractProposal([withCode]).contract.taxTreatment).toBe('N2.2');
	expect(buildClientContractProposal([invoice()]).contract.taxTreatment).toBe('');
});

test('several invoices for the same customer produce one proposal, starting from the earliest', () => {
	const invoices = [
		invoice({ number: '2024/2', issueDate: '2024-02-15', total: minorUnits(200000) }),
		invoice({ number: '2024/1', issueDate: '2024-01-15', total: minorUnits(100000) }),
		invoice({ number: '2024/3', issueDate: '2024-03-15', total: minorUnits(300000) })
	];
	const proposal = buildClientContractProposal(invoices);
	expect(proposal.contract.startsOn).toBe('2024-01-15');
	expect(proposal.observedRecurringAmount).toBe(200000);
	expect(proposal.observedCadence).toBe('monthly');
	expect(proposal.contract.invoicingCadence).toBe('monthly');
});
