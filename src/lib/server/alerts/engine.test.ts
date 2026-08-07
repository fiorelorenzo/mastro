// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Integration
// coverage on top of `detectors.test.ts` (pure math) and
// `repository.test.ts` (query correctness): this proves the whole stack
// — repository, detector and acknowledgement bookkeeping — composes
// correctly through `detectAlerts`/`listActiveAlerts`.
//
// `detectAlerts` always fetches every alert type, including
// `backup_failure`, which fires `never_run` the instant `backup_run` is
// empty — true in every rolled-back transaction here. Assertions below
// look up the specific alert under test rather than asserting the whole
// array, exactly because of that expected background noise.

import { afterAll, expect, test } from 'vitest';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import { client, contract, type ExpensePolicy, type PaymentTerms } from '$lib/server/db/schema';
import { detectAlerts, listActiveAlerts } from './engine';
import { acknowledgeAlert } from './state';

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
	return contractRow;
}

test('detectAlerts combines an active contract deadline with the always-on backup check', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { endsOn: '2026-08-10' }); // 3 days out from asOfDate

			const alerts = await detectAlerts('2026-08-07', tx);
			expect(alerts.find((a) => a.key === `contract_expiring:${contractRow.id}`)).toMatchObject({
				severity: 'critical'
			});
			expect(alerts.find((a) => a.key === 'backup_failure:global')).toMatchObject({
				severity: 'critical'
			});

			tx.rollback();
		})
	).rejects.toThrow();
});

test('listActiveAlerts marks an acknowledged alert as such without removing it from the list', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { endsOn: '2026-08-10' });
			const key = `contract_expiring:${contractRow.id}`;

			const before = await listActiveAlerts('2026-08-07', tx);
			const alertBefore = before.find((a) => a.key === key)!;
			expect(alertBefore.acknowledged).toBe(false);
			expect(alertBefore.acknowledgedAt).toBeNull();

			await acknowledgeAlert(alertBefore, 'lorenzo@example.com', tx);

			const after = await listActiveAlerts('2026-08-07', tx);
			const alertAfter = after.find((a) => a.key === key)!;
			expect(alertAfter.acknowledged).toBe(true);
			expect(alertAfter.acknowledgedBy).toBe('lorenzo@example.com');
			// Still present — acknowledging is not resolving (#74).
			expect(alertAfter.key).toBe(key);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an acknowledgement stops covering the alert once it escalates to a higher severity — the condition is still visible, not hidden', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { endsOn: '2026-08-20' }); // 13 days out: serious

			const atSerious = await listActiveAlerts('2026-08-07', tx);
			const key = `contract_expiring:${contractRow.id}`;
			const serious = atSerious.find((a) => a.key === key)!;
			expect(serious.severity).toBe('serious');
			await acknowledgeAlert(serious, 'lorenzo@example.com', tx);

			// Nothing changed: re-reading the same day still shows it acknowledged.
			const stillAcknowledged = (await listActiveAlerts('2026-08-07', tx)).find(
				(a) => a.key === key
			)!;
			expect(stillAcknowledged.acknowledged).toBe(true);

			// Four days later the same contract is inside the critical band —
			// a strictly higher severity than what was acknowledged.
			const escalated = (await listActiveAlerts('2026-08-16', tx)).find((a) => a.key === key)!;
			expect(escalated.severity).toBe('critical');
			expect(escalated.acknowledged).toBe(false);
			// The earlier acknowledgement is not forgotten — it stayed on record,
			// it just no longer covers this stronger fact.
			expect(escalated.acknowledgedBy).toBe('lorenzo@example.com');

			tx.rollback();
		})
	).rejects.toThrow();
});
