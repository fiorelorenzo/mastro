// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// transaction-rollback pattern as the rest of this directory.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '$lib/server/db';
import { detectWorkedWithoutApproval } from './detectors';
import {
	acknowledgeAlert,
	covers,
	DEFAULT_PREFERENCE,
	listAcknowledgements,
	listAlertPreferences,
	listDeliveries,
	recordDelivery,
	setAlertPreference
} from './state';
import type { Alert } from './types';

afterAll(async () => {
	await pool.end();
});

function alert(overrides: Partial<Alert> = {}): Alert {
	return {
		key: 'contract_expiring:c-1',
		severity: 'warning',
		detail: {
			type: 'contract_expiring',
			contractId: 'c-1',
			clientId: 'cl-1',
			contractTitle: 'Consulting agreement',
			clientLegalName: 'Acme Srl',
			endsOn: '2026-09-01',
			daysUntilEnd: 20
		},
		...overrides
	};
}

// ── covers ───────────────────────────────────────────────────────────────

test('covers is false with no record, true at or above the recorded rank, false below it', () => {
	expect(covers(undefined, 'warning')).toBe(false);
	expect(covers({ severityRank: 2 }, 'warning')).toBe(true); // 1 <= 2
	expect(covers({ severityRank: 2 }, 'serious')).toBe(true); // 2 <= 2
	expect(covers({ severityRank: 2 }, 'critical')).toBe(false); // 3 > 2
});

// ── acknowledgeAlert ─────────────────────────────────────────────────────

test('acknowledging an alert records it, and re-acknowledging updates the same row rather than adding a second one', async () => {
	await inRolledBackTransaction(async (tx) => {
		const a = alert({ key: `contract_expiring:${crypto.randomUUID()}` });

		await acknowledgeAlert(a, 'lorenzo@example.com', tx);
		let acks = await listAcknowledgements(tx);
		expect(acks.get(a.key)).toMatchObject({
			severityRank: 1,
			acknowledgedBy: 'lorenzo@example.com'
		});

		// The alert escalated; re-acknowledging at the new severity refreshes the rank.
		await acknowledgeAlert({ ...a, severity: 'critical' }, 'lorenzo@example.com', tx);
		acks = await listAcknowledgements(tx);
		expect(acks.size).toBe(1); // still one row, not two
		expect(acks.get(a.key)?.severityRank).toBe(3);
	});
});

test('an acknowledgement covers the severity it was made at, but a strictly higher severity reopens it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const a = alert({ key: `contract_expiring:${crypto.randomUUID()}`, severity: 'serious' });
		await acknowledgeAlert(a, 'lorenzo@example.com', tx);

		const acks = await listAcknowledgements(tx);
		const ack = acks.get(a.key);
		expect(covers(ack, 'warning')).toBe(true);
		expect(covers(ack, 'serious')).toBe(true);
		expect(covers(ack, 'critical')).toBe(false);
	});
});

// ── recordDelivery ───────────────────────────────────────────────────────

test('recordDelivery is upserted per alertKey the same way acknowledgement is, across channels', async () => {
	await inRolledBackTransaction(async (tx) => {
		const a = alert({ key: `invoice_overdue:${crypto.randomUUID()}` });

		await recordDelivery(a, 'digest', tx);
		let deliveries = await listDeliveries(tx);
		expect(deliveries.get(a.key)).toMatchObject({ severityRank: 1, channel: 'digest' });

		await recordDelivery({ ...a, severity: 'critical' }, 'push', tx);
		deliveries = await listDeliveries(tx);
		expect(deliveries.size).toBe(1);
		expect(deliveries.get(a.key)).toMatchObject({ severityRank: 3, channel: 'push' });
	});
});

// ── escalation clears delivery dedup (#229) ─────────────────────────────

test('a worked_without_approval risk that ages past the escalation threshold re-detects at a strictly higher severity, which delivery dedup does not cover — the fix for "raised once, then silent forever"', async () => {
	await inRolledBackTransaction(async (tx) => {
		const row = {
			workUnitId: crypto.randomUUID(),
			contractId: 'contract-1',
			clientId: 'client-1',
			contractTitle: 'Consulting agreement',
			clientLegalName: 'Acme Srl',
			date: '2026-08-04', // Tuesday
			sinceAt: '2026-08-04T09:00:00.000Z'
		};

		// Tuesday: freshly at risk, delivered once at `serious`.
		const [freshAlert] = detectWorkedWithoutApproval([row], '2026-08-04');
		expect(freshAlert.severity).toBe('serious');
		await recordDelivery(freshAlert, 'digest', tx);

		let deliveries = await listDeliveries(tx);
		expect(covers(deliveries.get(freshAlert.key), 'serious')).toBe(true);

		// Friday, three days later, still unresolved: the same occurrence
		// (same `key`) now detects at `critical` — before #229's fix this
		// alert was hardcoded `critical` from day one, so a second detection
		// never carried a higher rank than what was already delivered and
		// `covers` suppressed it forever. Escalating through
		// `severityForDaysElapsed` gives it a strictly higher rank instead.
		const [agedAlert] = detectWorkedWithoutApproval([row], '2026-08-07');
		expect(agedAlert.key).toBe(freshAlert.key);
		expect(agedAlert.severity).toBe('critical');
		expect(covers(deliveries.get(agedAlert.key), agedAlert.severity)).toBe(false);

		// Delivering it again at the new severity records the higher rank —
		// the second delivery this issue asks for.
		await recordDelivery(agedAlert, 'digest', tx);
		deliveries = await listDeliveries(tx);
		expect(deliveries.get(agedAlert.key)).toMatchObject({ severityRank: 3 });
	});
});

// ── alert preferences ────────────────────────────────────────────────────

test('a type with no preference row defaults to both channels on', async () => {
	await inRolledBackTransaction(async (tx) => {
		const preferences = await listAlertPreferences(tx);
		expect(preferences.get('backup_failure')).toBeUndefined();
		expect(preferences.get('backup_failure') ?? DEFAULT_PREFERENCE).toEqual({
			digestEnabled: true,
			pushEnabled: true
		});
	});
});

test('setAlertPreference persists both channels and setting it again overwrites rather than duplicating', async () => {
	await inRolledBackTransaction(async (tx) => {
		await setAlertPreference(
			'ceiling_approaching',
			{ digestEnabled: false, pushEnabled: true },
			tx
		);
		let preferences = await listAlertPreferences(tx);
		expect(preferences.get('ceiling_approaching')).toEqual({
			digestEnabled: false,
			pushEnabled: true
		});

		await setAlertPreference(
			'ceiling_approaching',
			{ digestEnabled: false, pushEnabled: false },
			tx
		);
		preferences = await listAlertPreferences(tx);
		expect(preferences.size).toBe(1);
		expect(preferences.get('ceiling_approaching')).toEqual({
			digestEnabled: false,
			pushEnabled: false
		});
	});
});
