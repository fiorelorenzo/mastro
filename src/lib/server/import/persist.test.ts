// #44/#48. Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Postgres work happens inside a transaction that is always rolled back,
// same pattern as `repositories/invoice.test.ts` and `confirm.test.ts`.
// The structured document is a throwaway JSON "format", the same
// convention `review.test.ts` uses, so a test controls the natural key and
// amounts directly instead of hand-writing FatturaPA XML for every case.
import { and, eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { minorUnits } from '$lib/money';
import {
	client,
	contract,
	document,
	invoice,
	invoiceLine,
	rateCard,
	workUnit,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { hashContent } from '$lib/server/documents/blob-store';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import { buildAdapterRegistry } from './registry';
import {
	persistImportedInvoice,
	type PersistInvoiceOutcome,
	type PersistInvoiceRequest
} from './persist';
import type { Invoice, InvoiceParty } from './invoice';

afterAll(async () => {
	await pool.end();
});

const ACCOUNT_HOLDER_TAX_ID = 'IT11111111111';
const ACTOR = { kind: 'human' as const, email: 'lorenzo@example.com' };

// Always decodes to an array, matching `InvoiceFormatAdapter.parse`'s real
// contract (#101) — `jsonFile` below wraps a single invoice in a
// one-element array for the ordinary case, `jsonFileBatch` hands over more
// than one for the FatturaPA-batch-shaped case. Kept local to this file,
// same as `review.test.ts`'s own copy — each import test file defines its
// own throwaway adapter rather than sharing one.
const fakeAdapter: InvoiceFormatAdapter = {
	id: 'test-json-invoice',
	detect: (file) => file.filename.endsWith('.json'),
	parse: (file) => JSON.parse(new TextDecoder().decode(file.content)) as Invoice[]
};
const registry = buildAdapterRegistry([fakeAdapter]);
const pack = { formats: [fakeAdapter.id] };

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

function invoiceDoc(overrides: Partial<Invoice> = {}): Invoice {
	return {
		number: '2024/1',
		issueDate: '2024-03-15',
		documentType: 'invoice',
		currency: 'EUR',
		supplier: party({ taxId: ACCOUNT_HOLDER_TAX_ID, legalName: 'Consultant' }),
		customer: party(),
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(100000),
				amount: minorUnits(100000),
				taxRate: 22
			}
		],
		taxSummary: [{ taxRate: 22, taxableAmount: minorUnits(100000), taxAmount: minorUnits(22000) }],
		taxableAmount: minorUnits(100000),
		taxAmount: minorUnits(22000),
		total: minorUnits(122000),
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: ACCOUNT_HOLDER_TAX_ID, progressiveNumber: '1' },
		...overrides
	};
}

function jsonFile(filename: string, value: Invoice): ImportableFile {
	return { filename, content: new TextEncoder().encode(JSON.stringify([value])) };
}

function jsonFileBatch(filename: string, values: Invoice[]): ImportableFile {
	return { filename, content: new TextEncoder().encode(JSON.stringify(values)) };
}

/** Narrows a `created` outcome and returns its `invoiceId`, failing the
 * test with a clear message instead of an inline cast when the outcome
 * turned out to be something else. */
function expectCreated(outcome: PersistInvoiceOutcome): string {
	if (outcome.kind !== 'created') {
		throw new Error(`expected a created outcome, got ${outcome.kind}`);
	}
	return outcome.invoiceId;
}

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	paymentTerms: PaymentTerms = { kind: 'net', days: 30 }
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
			paymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

async function countRows(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const invoiceRows = await tx.select().from(invoice).where(eq(invoice.contractId, contractId));
	const lineRows = invoiceRows.length
		? await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceRows[0].id))
		: [];
	const documentRows = await tx
		.select()
		.from(document)
		.where(and(eq(document.contractId, contractId), eq(document.ownerType, 'invoice')));
	const workUnitRows = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractId));
	return {
		invoices: invoiceRows.length,
		lines: lineRows.length,
		documents: documentRows.length,
		workUnitStates: workUnitRows.map((row) => ({ id: row.id, state: row.state }))
	};
}

test('persisting a new imported invoice creates the invoice, one line and the structured document', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const before = await countRows(tx, contractRow.id);
		expect(before.invoices).toBe(0);

		const outcome = await persistImportedInvoice(
			{
				file: jsonFile('a.json', invoiceDoc()),
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'imported from a fixture folder',
			tx
		);
		expect(outcome.kind).toBe('created');

		const after = await countRows(tx, contractRow.id);
		expect(after.invoices).toBe(1);
		expect(after.lines).toBe(1);
		expect(after.documents).toBe(1);
	});
});

test('re-running the same import a second time creates nothing: outcome is already_present, row counts unchanged', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const file = jsonFile('a.json', invoiceDoc());
		const request: PersistInvoiceRequest = {
			file,
			invoiceIndex: 0,
			attachments: [],
			contractId: contractRow.id,
			lineDecisions: [{ workUnitIds: [] }]
		};

		const first = await persistImportedInvoice(
			request,
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'first import',
			tx
		);
		const invoiceId = expectCreated(first);
		const afterFirst = await countRows(tx, contractRow.id);

		// The second run reflects the database exactly as the route handler
		// would re-fetch it: the invoice `persistImportedInvoice` just wrote,
		// carrying the hash of the file just stored.
		const existingInvoices = [
			{
				id: invoiceId,
				number: '2024/1',
				issueDate: '2024-03-15',
				hashes: [hashContent(file.content)]
			}
		];

		const second = await persistImportedInvoice(
			request,
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			existingInvoices,
			ACTOR,
			'second import of the same folder',
			tx
		);
		expect(second.kind).toBe('already_present');

		const afterSecond = await countRows(tx, contractRow.id);
		expect(afterSecond).toEqual(afterFirst);
	});
});

test('a structured document plus a companion attachment produce one invoice with two stored documents', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const structured = jsonFile('2024/invoice-1.json', invoiceDoc());
		const companion: ImportableFile = {
			filename: '2024/invoice-1.pdf',
			content: new TextEncoder().encode('pdf bytes')
		};

		const outcome = await persistImportedInvoice(
			{
				file: structured,
				invoiceIndex: 0,
				attachments: [companion],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'imported with its companion PDF',
			tx
		);
		expect(outcome.kind).toBe('created');

		const after = await countRows(tx, contractRow.id);
		expect(after.invoices).toBe(1);
		expect(after.documents).toBe(2);
	});
});

test('a re-issue with the same natural key but different content is a conflict, never merged: nothing new is written', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const original = jsonFile('a.json', invoiceDoc());

		const first = await persistImportedInvoice(
			{
				file: original,
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'first issue',
			tx
		);
		const invoiceId = expectCreated(first);
		const afterFirst = await countRows(tx, contractRow.id);

		const existingInvoices = [
			{
				id: invoiceId,
				number: '2024/1',
				issueDate: '2024-03-15',
				hashes: [hashContent(original.content)]
			}
		];

		// Same number and year, different total: a genuine re-issue.
		const reissued = jsonFile('a-reissued.json', invoiceDoc({ total: minorUnits(999999) }));
		const second = await persistImportedInvoice(
			{
				file: reissued,
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			existingInvoices,
			ACTOR,
			're-issue with the same number',
			tx
		);
		expect(second).toEqual({
			kind: 'conflict',
			filename: 'a-reissued.json',
			existingInvoiceNumber: '2024/1'
		});

		const afterSecond = await countRows(tx, contractRow.id);
		expect(afterSecond).toEqual(afterFirst);
	});
});

test('confirming a day-mapping decision links the accepted days and moves them to invoiced', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(rateCard).values({
			contractId: contractRow.id,
			validFrom: '2024-01-01',
			validTo: null,
			kind: 'daily',
			amount: 600,
			unit: 'day',
			allowedFractions: [1],
			minimumHours: null,
			disbursementPeriod: null
		});
		const [day1, day2] = await tx
			.insert(workUnit)
			.values([
				{
					contractId: contractRow.id,
					date: '2024-03-01',
					quantity: 1,
					scope: 'work',
					state: 'worked'
				},
				{
					contractId: contractRow.id,
					date: '2024-03-02',
					quantity: 1,
					scope: 'work',
					state: 'worked'
				}
			])
			.returning();

		const outcome = await persistImportedInvoice(
			{
				file: jsonFile(
					'a.json',
					invoiceDoc({
						lines: [
							{
								description: 'Two days',
								quantity: 2,
								unitPrice: minorUnits(60000),
								amount: minorUnits(120000),
								taxRate: 22
							}
						]
					})
				),
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [day1.id, day2.id] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'confirmed day mapping',
			tx
		);
		const invoiceId = expectCreated(outcome);

		const [line] = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
		const days = await tx.select().from(workUnit).where(eq(workUnit.contractId, contractRow.id));
		for (const day of days) {
			expect(day.state).toBe('invoiced');
			expect(day.invoiceLineId).toBe(line.id);
		}
	});
});

test('rejecting a day-mapping proposal (empty workUnitIds) leaves the days completely untouched', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const [day] = await tx
			.insert(workUnit)
			.values({
				contractId: contractRow.id,
				date: '2024-03-01',
				quantity: 1,
				scope: 'work',
				state: 'worked'
			})
			.returning();
		const before = await tx.select().from(workUnit).where(eq(workUnit.id, day.id));

		const outcome = await persistImportedInvoice(
			{
				file: jsonFile('a.json', invoiceDoc()),
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				// The reviewer rejected the proposal: no day is linked.
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'day mapping rejected',
			tx
		);
		expect(outcome.kind).toBe('created');

		const after = await tx.select().from(workUnit).where(eq(workUnit.id, day.id));
		expect(after).toEqual(before);
		expect(after[0].state).toBe('worked');
		expect(after[0].invoiceLineId).toBeNull();
	});
});

test('a mismatched line-decision count is rejected rather than guessed at', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			(
				await rejection(() =>
					persistImportedInvoice(
						{
							file: jsonFile('a.json', invoiceDoc()),
							invoiceIndex: 0,
							attachments: [],
							contractId: contractRow.id,
							lineDecisions: []
						},
						pack,
						registry,
						ACCOUNT_HOLDER_TAX_ID,
						[],
						ACTOR,
						'mismatched decisions',
						tx
					)
				)
			).message
		).toMatch(/decision/);
	});
});

test('an incoming invoice is rejected, never persisted as revenue', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			(
				await rejection(() =>
					persistImportedInvoice(
						{
							file: jsonFile('a.json', invoiceDoc({ supplier: party({ taxId: 'IT99999999999' }) })),
							invoiceIndex: 0,
							attachments: [],
							contractId: contractRow.id,
							lineDecisions: [{ workUnitIds: [] }]
						},
						pack,
						registry,
						ACCOUNT_HOLDER_TAX_ID,
						[],
						ACTOR,
						'incoming, rejected',
						tx
					)
				)
			).message
		).toMatch(/incoming/);
	});
});

test('a batch file whose adapter parses to two invoices persists each independently by invoiceIndex, as two separate invoice rows; an out-of-range invoiceIndex is rejected (#101)', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const batchFile = jsonFileBatch('batch.json', [
			invoiceDoc({ number: '2024/1' }),
			invoiceDoc({ number: '2024/2' })
		]);

		const firstOutcome = await persistImportedInvoice(
			{
				file: batchFile,
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'first body of the batch',
			tx
		);
		const firstInvoiceId = expectCreated(firstOutcome);

		// A second, independent call — matching how the confirm route
		// sends two separate confirm-list entries for the same file
		// (Part I / #101), not a single call handling both bodies.
		const secondOutcome = await persistImportedInvoice(
			{
				file: batchFile,
				invoiceIndex: 1,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'second body of the batch',
			tx
		);
		const secondInvoiceId = expectCreated(secondOutcome);

		expect(firstInvoiceId).not.toBe(secondInvoiceId);
		const after = await countRows(tx, contractRow.id);
		expect(after.invoices).toBe(2);

		const singleFile = jsonFile('single.json', invoiceDoc());
		expect(
			(
				await rejection(() =>
					persistImportedInvoice(
						{
							file: singleFile,
							invoiceIndex: 5,
							attachments: [],
							contractId: contractRow.id,
							lineDecisions: [{ workUnitIds: [] }]
						},
						pack,
						registry,
						ACCOUNT_HOLDER_TAX_ID,
						[],
						ACTOR,
						'out of range invoiceIndex',
						tx
					)
				)
			).message
		).toMatch(/no longer has an invoice at index/);
	});
});
