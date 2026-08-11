// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres
// work happens inside a transaction that is always rolled back, same
// pattern as `repositories/work-unit.test.ts`. `createApproval`/
// `storeDocument` write to disk, so `DOCUMENT_STORAGE_ROOT` points at a
// throwaway temp directory removed in `afterEach`, same as
// `repositories/worked-without-approval.test.ts`.
//
// This file proves the *query* is correct — which rows come back, and
// which are correctly excluded once a condition resolves. Severity/timing
// math is `detectors.test.ts`'s job, exercised there without a database.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { minorUnits, NO_MINOR_UNITS } from '$lib/money';
import {
	backupRun,
	client,
	contract,
	document,
	documentMirrorRun,
	mailboxPollRun,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { createApproval } from '$lib/server/repositories/approval';
import { storeDocument } from '$lib/server/repositories/document';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';
import {
	createWorkUnit,
	transitionWorkUnit,
	linkApprovalToWorkUnit
} from '$lib/server/repositories/work-unit';
import {
	fetchApprovalUnactionedRows,
	fetchContractsForBillablePeriod,
	fetchContractsForDeadlineAlerts,
	fetchLatestBackupRun,
	fetchLatestMailboxPollRun,
	fetchMirrorFailureRows,
	fetchWorkedWithoutApprovalRows,
	fetchYearEndOverrunInputs
} from './repository';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-alerts-repository-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-${crypto.randomUUID()}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(
	tx: DbExecutor,
	overrides: Partial<typeof contract.$inferInsert> = {}
) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			status: 'active',
			...overrides
		})
		.returning();
	return { clientRow, contractRow };
}

async function insertApproval(
	tx: DbExecutor,
	contractId: string,
	overrides: { receivedAt?: Date } = {}
) {
	return createApproval(
		{
			contractId,
			channel: 'email',
			sender: 'client@example.com',
			receivedAt: overrides.receivedAt ?? new Date(),
			messageId: null,
			excerpt: 'Yes, go ahead.',
			origin: { kind: 'manual' },
			document: {
				bytes: new TextEncoder().encode('Yes, go ahead.'),
				mime: 'text/plain',
				originalName: 'approval.txt',
				provenance: 'mail',
				confidential: false
			}
		},
		tx
	);
}

async function insertDocument(tx: DbExecutor, contractId: string) {
	return storeDocument(
		{
			bytes: new TextEncoder().encode(`doc-${crypto.randomUUID()}`),
			mime: 'application/pdf',
			originalName: 'signed.pdf',
			provenance: 'upload',
			contractId,
			confidential: false,
			ownerType: 'contract',
			ownerId: contractId
		},
		tx
	);
}

// ── fetchContractsForDeadlineAlerts ─────────────────────────────────────

test('fetchContractsForDeadlineAlerts returns only active contracts with an end date', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow: withEnd } = await insertContract(tx, { endsOn: '2026-12-31' });
		await insertContract(tx, { endsOn: null }); // no end date: no deadline to speak of
		await insertContract(tx, { endsOn: '2026-12-31', status: 'draft' }); // not active yet

		const rows = await fetchContractsForDeadlineAlerts(tx);
		expect(rows).toHaveLength(1);
		expect(rows[0].contractId).toBe(withEnd.id);
	});
});

// ── fetchWorkedWithoutApprovalRows ──────────────────────────────────────

test('fetchWorkedWithoutApprovalRows returns a day currently at risk and drops one recovered by a late approval', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx, { requiresPriorApproval: true });

		const atRisk = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-01-10',
				quantity: 1,
				scope: 'work',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded without approval',
			tx
		);
		const recovered = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-01-11',
				quantity: 1,
				scope: 'work',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded without approval, fixed later',
			tx
		);
		const approvalRow = await insertApproval(tx, contractRow.id);
		await linkApprovalToWorkUnit(
			recovered.id,
			approvalRow.id,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'late approval arrived',
			// Without the transaction this writes through the pool, updates no
			// row, and reports success: the day stays at risk and the test
			// still passed under the old pattern.
			tx
		);

		const rows = await fetchWorkedWithoutApprovalRows(tx);
		const ids = rows.map((r) => r.workUnitId);
		expect(ids).toContain(atRisk.id);
		expect(ids).not.toContain(recovered.id);
	});
});

// ── fetchApprovalUnactionedRows ─────────────────────────────────────────

test('fetchApprovalUnactionedRows returns an approval with no linked day and drops one that is linked', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const unactioned = await insertApproval(tx, contractRow.id);
		const actioned = await insertApproval(tx, contractRow.id);
		// `approved` is reached, never inserted (drizzle/0012): a day starts at
		// `proposed` and the approval is what moves it.
		const agreed = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-01-10',
				quantity: 1,
				scope: 'work',
				state: 'proposed'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'day proposed',
			tx
		);
		await transitionWorkUnit(
			agreed.id,
			{ state: 'approved', approvalId: actioned.id },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'day agreed',
			tx
		);

		const rows = await fetchApprovalUnactionedRows(tx);
		const ids = rows.map((r) => r.approvalId);
		expect(ids).toContain(unactioned.id);
		expect(ids).not.toContain(actioned.id);
	});
});

// ── fetchContractsForBillablePeriod ─────────────────────────────────────

test('fetchContractsForBillablePeriod only returns a periodic contract that actually has unbilled eligible days', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow: withEligible } = await insertContract(tx, {
			invoicingCadence: 'monthly'
		});
		await createWorkUnit(
			{
				contractId: withEligible.id,
				date: '2026-01-05',
				quantity: 1,
				scope: 'work',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'worked',
			tx
		);

		await insertContract(tx, { invoicingCadence: 'monthly' }); // nothing recorded at all
		await insertContract(tx, { invoicingCadence: 'on_completion' }); // wrong cadence entirely

		const rows = await fetchContractsForBillablePeriod(tx);
		const ids = rows.map((r) => r.contractId);
		expect(ids).toEqual([withEligible.id]);
		expect(rows[0].eligibleDates).toEqual(['2026-01-05']);
	});
});

// ── fetchLatestBackupRun ────────────────────────────────────────────────

test('fetchLatestBackupRun returns the most recent row, null when none exist', async () => {
	await inRolledBackTransaction(async (tx) => {
		expect(await fetchLatestBackupRun(tx)).toBeNull();

		// Explicit timestamps: `now()` is the transaction's start time, so two
		// rows inserted here would tie and `ORDER BY created_at DESC` would
		// pick either one.
		await tx
			.insert(backupRun)
			.values({ status: 'failure', detail: 'first', createdAt: new Date('2026-02-01T03:17:00Z') });
		const [second] = await tx
			.insert(backupRun)
			.values({ status: 'success', detail: null, createdAt: new Date('2026-02-02T03:17:00Z') })
			.returning();

		const latest = await fetchLatestBackupRun(tx);
		expect(latest?.status).toBe('success');
		expect(latest?.detail).toBeNull();
		void second;
	});
});

// ── fetchMirrorFailureRows ───────────────────────────────────────────────

test('fetchMirrorFailureRows is empty when the mirror is not configured, even with unmirrored documents on file', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		await insertDocument(tx, contractRow.id);

		expect(await fetchMirrorFailureRows(false, tx)).toEqual([]);
	});
});

test('fetchMirrorFailureRows excludes an already-mirrored document and attaches the latest run for one still pending', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const pending = await insertDocument(tx, contractRow.id);
		const mirrored = await insertDocument(tx, contractRow.id);
		await tx.update(document).set({ remoteFileId: 'remote-1' }).where(eq(document.id, mirrored.id));

		await tx.insert(documentMirrorRun).values({
			documentId: pending.id,
			status: 'failure',
			detail: 'first attempt',
			createdAt: new Date('2026-02-01T06:00:00Z')
		});
		await tx.insert(documentMirrorRun).values({
			documentId: pending.id,
			status: 'failure',
			detail: 'second attempt, the latest',
			createdAt: new Date('2026-02-01T07:00:00Z')
		});

		// This query is instance-wide by design: it feeds an alert about every
		// unmirrored document there is. So the assertion is about this test's
		// own two documents, not about the size of the whole answer, which
		// another test's committed fixtures can legitimately add to.
		const rows = await fetchMirrorFailureRows(true, tx);
		const ids = rows.map((row) => row.documentId);
		expect(ids).toContain(pending.id);
		expect(ids).not.toContain(mirrored.id);
		expect(rows.find((row) => row.documentId === pending.id)?.latestRun).toMatchObject({
			status: 'failure',
			detail: 'second attempt, the latest'
		});
	});
});

// ── fetchLatestMailboxPollRun ────────────────────────────────────────────

test('fetchLatestMailboxPollRun reports not configured when the mail account is not set up, even with a contract mapped', async () => {
	await inRolledBackTransaction(async (tx) => {
		await insertContract(tx, { mailFolder: 'Acme Corp' });
		await tx.insert(mailboxPollRun).values({ status: 'success', detail: null });

		expect(await fetchLatestMailboxPollRun(false, tx)).toEqual({
			pollingConfigured: false,
			latestRun: null
		});
	});
});

test('fetchLatestMailboxPollRun reports not configured when the account is set up but no contract has a folder mapped', async () => {
	await inRolledBackTransaction(async (tx) => {
		await insertContract(tx); // mailFolder left null

		expect(await fetchLatestMailboxPollRun(true, tx)).toEqual({
			pollingConfigured: false,
			latestRun: null
		});
	});
});

test('fetchLatestMailboxPollRun returns the most recent row once configured, null when none exist yet', async () => {
	await inRolledBackTransaction(async (tx) => {
		await insertContract(tx, { mailFolder: 'Acme Corp' });

		expect(await fetchLatestMailboxPollRun(true, tx)).toEqual({
			pollingConfigured: true,
			latestRun: null
		});

		// Same reason as the backup run above: distinct times, or the "latest"
		// of two rows sharing the transaction's clock is undefined.
		await tx.insert(mailboxPollRun).values({
			status: 'failure',
			detail: 'first',
			createdAt: new Date('2026-02-01T06:00:00Z')
		});
		await tx.insert(mailboxPollRun).values({
			status: 'success',
			detail: null,
			createdAt: new Date('2026-02-01T07:00:00Z')
		});

		const result = await fetchLatestMailboxPollRun(true, tx);
		expect(result.pollingConfigured).toBe(true);
		expect(result.latestRun?.status).toBe('success');
		expect(result.latestRun?.detail).toBeNull();
	});
});

// ── fetchYearEndOverrunInputs ────────────────────────────────────────────

function invoiceInput(contractId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		contractId,
		number: `2026/${Math.floor(Math.random() * 100000)}`,
		issueDate: '2026-02-01',
		documentType: 'invoice',
		currency: 'EUR',
		taxTreatmentCode: null,
		statutoryReference: null,
		stampDuty: null,
		socialCharge: null,
		dueDate: '2026-03-01',
		paymentMethod: null,
		iban: null,
		transmissionId: null,
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(100000),
				amount: minorUnits(100000),
				taxRate: 0,
				taxTreatmentCode: null,
				workUnitIds: []
			}
		],
		...overrides
	};
}

test('fetchYearEndOverrunInputs only builds a figure for all_clients, cash-basis ceilings', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		await createInvoice(
			invoiceInput(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'issued',
			tx
		);

		const cashAllClients = {
			ceiling: {
				id: 'cash-all',
				origin: 'pack' as const,
				label: { en: 'x', it: 'x' },
				basis: 'cash_received_calendar_year' as const,
				perimeter: { kind: 'all_clients' as const },
				alertLevels: [],
				consequence: { en: 'x', it: 'x' },
				measure: 'absolute_amount' as const,
				value: minorUnits(1000000)
			},
			period: { from: '2026-01-01', to: '2027-01-01' },
			currentValue: NO_MINOR_UNITS,
			limitValue: minorUnits(1000000),
			usageRatio: 0,
			crossed: false,
			activeAlertLevels: []
		};
		const accrual = {
			...cashAllClients,
			ceiling: {
				...cashAllClients.ceiling,
				id: 'accrual',
				basis: 'invoiced_calendar_year' as const
			}
		};
		const perClient = {
			...cashAllClients,
			ceiling: {
				...cashAllClients.ceiling,
				id: 'per-client',
				perimeter: { kind: 'client' as const, clientId: contractRow.clientId }
			}
		};

		const inputs = await fetchYearEndOverrunInputs(
			[cashAllClients, accrual, perClient],
			'2026-06-01',
			tx
		);
		expect(inputs.map((i) => i.evaluated.ceiling.id)).toEqual(['cash-all']);
	});
});
