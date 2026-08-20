import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { rejection } from '$lib/server/db/pg-error';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createWorkUnit,
	listWorkUnitTransitions,
	rejectWorkUnit,
	revokeWorkUnit,
	transitionWorkUnit
} from './work-unit';

// #370: `revoked` (an approval withdrawn before the day was worked) and
// `rejected` (a proposed day that never took place) were `work_unit`
// states the trigger already allowed and no screen could reach — see
// `work-unit-reachability.test.ts` for the enum-wide correspondence
// check this file's own two functions now satisfy. Same transaction-
// rollback pattern as `dispute.test.ts` and `work-unit.test.ts`; neither
// path here writes a document, so no `DOCUMENT_STORAGE_ROOT` setup is
// needed.

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
			// No approval required: keeps building an 'approved' day to a
			// plain two-step transition, the same shortcut worked-without-
			// approval.test.ts's own easy cases use. The trigger's legality
			// check for `approved -> revoked` does not depend on this flag.
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

const LORENZO = { kind: 'human', email: 'lorenzo@example.com' } as const;

test('revokeWorkUnit transitions an approved day to revoked, legal only from approved', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const proposed = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-06-01', quantity: 1, scope: 'Audit trimestrale' },
			LORENZO,
			'giornata proposta',
			tx
		);

		// The trigger rejects the edge before this function is even in
		// play: revoking straight out of `proposed` is illegal.
		expect(
			await rejection(() => revokeWorkUnit(proposed.id, LORENZO, 'approvazione revocata', tx), tx)
		).toMatchObject({ code: 'P0001' });

		const approved = await transitionWorkUnit(
			proposed.id,
			{ state: 'approved' },
			LORENZO,
			'giornata approvata',
			tx
		);
		expect(approved.state).toBe('approved');

		const revoked = await revokeWorkUnit(
			approved.id,
			LORENZO,
			'il cliente ha revocato prima dello svolgimento',
			tx
		);
		expect(revoked.state).toBe('revoked');
		expect(revoked.approvalId).toBeNull();

		const log = await listWorkUnitTransitions(revoked.id, tx);
		expect(log.map((entry) => [entry.fromState, entry.toState])).toEqual([
			[null, 'proposed'],
			['proposed', 'approved'],
			['approved', 'revoked']
		]);
		expect(log.at(-1)?.reason).toBe('il cliente ha revocato prima dello svolgimento');
		expect(log.at(-1)?.actor).toEqual(LORENZO);

		// `revoked` is terminal: the allowed-edge list has no edge out of
		// it, the same way `unbillable` has none (0012_work_unit_state_
		// machine.sql).
		expect(
			await rejection(
				() =>
					transitionWorkUnit(revoked.id, { state: 'worked' }, LORENZO, 'tentativo illegale', tx),
				tx
			)
		).toMatchObject({ code: 'P0001' });
	});
});

test('rejectWorkUnit transitions a proposed day to rejected, legal only from proposed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const proposed = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-06-02', quantity: 1, scope: 'Verifica scorte' },
			LORENZO,
			'giornata proposta',
			tx
		);

		const rejected = await rejectWorkUnit(
			proposed.id,
			LORENZO,
			'la giornata non si e mai svolta',
			tx
		);
		expect(rejected.state).toBe('rejected');
		expect(rejected.invoiceLineId).toBeNull();

		const log = await listWorkUnitTransitions(rejected.id, tx);
		expect(log.map((entry) => [entry.fromState, entry.toState])).toEqual([
			[null, 'proposed'],
			['proposed', 'rejected']
		]);
		expect(log.at(-1)?.reason).toBe('la giornata non si e mai svolta');

		// Terminal, same as `revoked` above, and illegal from anywhere but
		// `proposed`: an already-approved day cannot be rejected.
		const second = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-06-03', quantity: 1, scope: 'Secondo audit' },
			LORENZO,
			'giornata proposta',
			tx
		);
		const approved = await transitionWorkUnit(
			second.id,
			{ state: 'approved' },
			LORENZO,
			'giornata approvata',
			tx
		);
		expect(
			await rejection(() => rejectWorkUnit(approved.id, LORENZO, 'tentativo illegale', tx), tx)
		).toMatchObject({ code: 'P0001' });
	});
});
