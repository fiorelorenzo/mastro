import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from '$lib/server/repositories/approval';
import { createWorkUnit, transitionWorkUnit } from '$lib/server/repositories/work-unit';
import { settleApprovedDays } from './settle';

// No `__fixtures__` module exists in this repository: inlined the same
// contract insert `repositories/work-unit.test.ts` uses, rather than
// importing across test files.
async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	requiresPriorApproval: boolean
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

/** An approved day, so the sweep has something legal to move. */
async function approvedDay(
	tx: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0],
	contractId: string,
	date: string
) {
	const day = await createWorkUnit(
		{ contractId, date, quantity: 1, scope: 'meetings' },
		{ kind: 'human', email: 'lorenzo@example.com' },
		'agreed in writing',
		tx
	);
	const approval = await createApproval(
		{
			contractId,
			channel: 'email',
			sender: 'client@example.com',
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			messageId: `<approval-${date}@example.com>`,
			excerpt: `confermo il ${date}`,
			origin: { kind: 'manual' },
			document: {
				bytes: new TextEncoder().encode(`confermo il ${date}`),
				mime: 'message/rfc822',
				originalName: 'approval.eml',
				provenance: 'mail',
				confidential: true
			}
		},
		tx
	);
	await transitionWorkUnit(
		day.id,
		{ state: 'approved', approvalId: approval.id },
		{ kind: 'human', email: 'lorenzo@example.com' },
		'accepted the proposal',
		tx
	);
	return day;
}

test('a day whose date has passed settles; today and tomorrow do not', async () => {
	// The boundary is the whole rule: a day must never become billable while
	// it is still in progress. Dates are fixed rather than relative to the
	// clock so the test says the same thing every day of the year.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const yesterday = await approvedDay(tx, contractRow.id, '2026-08-04');
		const today = await approvedDay(tx, contractRow.id, '2026-08-05');
		const tomorrow = await approvedDay(tx, contractRow.id, '2026-08-06');

		const outcome = await settleApprovedDays('2026-08-05', tx);
		return {
			outcome,
			states: await Promise.all(
				[yesterday, today, tomorrow].map(async (day) => {
					const [row] = await tx.select().from(workUnit).where(eq(workUnit.id, day.id));
					return row.state;
				})
			)
		};
	});

	expect(result.states).toEqual(['worked', 'approved', 'approved']);
	// Not `toBe(1)`: `settleApprovedDays` sweeps every approved day before the
	// cutoff, not only this contract's, and the database already holds data
	// (a demo seed, other files' committed rows) this test did not create.
	// The lower bound is the one fact this test itself guarantees — the
	// `states` assertion above is what actually proves *this* day was the
	// one settled.
	expect(result.outcome.settled).toBeGreaterThanOrEqual(1);
});

test('the sweep leaves alone every state that is not approved', async () => {
	// `proposed` is the one that matters: a day nobody agreed to must never
	// become billable on its own. The others are decisions.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const proposed = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-08-04', quantity: 1, scope: 'unagreed' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded as proposed',
			tx
		);
		const settled = await settleApprovedDays('2026-08-05', tx);
		const [row] = await tx.select().from(workUnit).where(eq(workUnit.id, proposed.id));
		return { settled, state: row.state };
	});

	// Not asserting `settled.settled === 0`: the sweep runs against a
	// database that may already hold other approved days due before the
	// cutoff (a demo seed, other files' committed rows), so a positive count
	// here would not be this test's bug. The state of the one day this test
	// created is the whole claim.
	expect(result.state).toBe('proposed');
});
