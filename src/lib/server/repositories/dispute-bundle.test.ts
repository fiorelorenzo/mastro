import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { minorUnits } from '$lib/money';
import { createApproval } from './approval';
import { createClauseNote } from './clause-note';
import { createInvoice } from './invoice';
import { createWorkUnit, disputeWorkUnit } from './work-unit';
import { buildDisputeBundle } from './dispute-bundle';

// #214. Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// transaction-rollback pattern as `dispute.test.ts`; `createApproval`
// writes a document to disk, so `DOCUMENT_STORAGE_ROOT` points at a
// throwaway temp directory removed in `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-dispute-bundle-'));
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
			legalName: `Nordwind Test ${crypto.randomUUID()}`,
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
			title: 'Consulenza operativa',
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

const LORENZO = { kind: 'human', email: 'lorenzo@example.com' } as const;

test('#214: the bundle for a disputed day carries its approval, its archived original, its own register entry, every clause note on the contract, and the line it landed on', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		await createClauseNote(
			{
				contractId: contractRow.id,
				clauseReference: 'Art. 7.2',
				verbatimText: 'Le spese di trasferta documentate sono rimborsate a piè di lista.',
				interpretationAdopted: 'La comunicazione via email è considerata valida.',
				notes: null
			},
			tx
		);
		const approval = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'elena.marchetti@nordwindlogistics.example',
				receivedAt: new Date('2026-06-01T09:00:00Z'),
				messageId: '<approval@nordwindlogistics.example>',
				excerpt: 'confermo la giornata del 15/06, procedi pure.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Da: Elena\nOggetto: Approvazione\n\nconfermo...'),
					mime: 'message/rfc822',
					originalName: 'approvazione.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-06-15',
				quantity: 1,
				scope: 'Audit scorte trimestrale',
				state: 'worked',
				approvalId: approval.id
			},
			LORENZO,
			'giornata svolta come da approvazione',
			tx
		);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: `DBUN-${crypto.randomUUID().slice(0, 8)}`,
				issueDate: '2026-06-20',
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
						description: 'Audit scorte trimestrale — 15/06/2026',
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
		await disputeWorkUnit(day.id, LORENZO, 'il cliente contesta la quantità fatturata', tx);

		const bundle = await buildDisputeBundle(day.id, tx);

		expect(bundle).not.toBeNull();
		expect(bundle?.state).toBe('disputed');
		expect(bundle?.date).toBe('2026-06-15');

		// Invariant 4: the archived original itself, not just its metadata.
		expect(bundle?.document?.originalName).toBe('approvazione.eml');
		expect(bundle?.document?.hash).toBeTruthy();

		expect(bundle?.approval?.excerpt).toBe('confermo la giornata del 15/06, procedi pure.');

		// The register entry is read for the calendar month the day falls
		// in — June 2026 — and carries this day, not a different period.
		expect(bundle?.register.from).toBe('2026-06-01');
		expect(bundle?.register.to).toBe('2026-06-30');
		expect(bundle?.register.entry?.workUnitId).toBe(day.id);

		expect(bundle?.clauseNotes).toHaveLength(1);
		expect(bundle?.clauseNotes[0]?.clauseReference).toBe('Art. 7.2');

		expect(bundle?.invoiceLine?.invoiceId).toBe(invoiceRow.id);
		expect(bundle?.invoiceLine?.amount).toBe(minorUnits(70000));
	});
});

test('#214: a billed day on a contract that never required approval still produces a bundle — honestly empty where there is nothing on file, never fabricated', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-06-10',
				quantity: 1,
				scope: 'Intervento senza approvazione scritta',
				state: 'worked'
			},
			LORENZO,
			'contratto senza obbligo di approvazione scritta',
			tx
		);
		await createInvoice(
			{
				contractId: contractRow.id,
				number: `DBUN-${crypto.randomUUID().slice(0, 8)}`,
				issueDate: '2026-06-12',
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
						description: 'Intervento — 10/06/2026',
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
		await disputeWorkUnit(day.id, LORENZO, 'contested anyway', tx);

		const bundle = await buildDisputeBundle(day.id, tx);

		expect(bundle?.approval).toBeNull();
		expect(bundle?.document).toBeNull();
		// `buildRegister`'s own `INNER JOIN` on `approval` excludes a day
		// with none on file (`register.ts`'s own documented decision) — the
		// bundle must not disagree with the register it is quoting from.
		expect(bundle?.register.entry).toBeNull();
		expect(bundle?.clauseNotes).toEqual([]);
	});
});

test('#214: buildDisputeBundle returns null for a work unit id that does not exist', async () => {
	await inRolledBackTransaction(async (tx) => {
		const bundle = await buildDisputeBundle('00000000-0000-0000-0000-000000000000', tx);
		expect(bundle).toBeNull();
	});
});
