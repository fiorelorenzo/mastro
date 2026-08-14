// #74's central acceptance bullet: every alert in epic #13's list fires on
// a constructed fixture at the right moment. No database here — every
// detector is a pure function over already-fetched rows, so a fixture is
// just a plain object literal, and "the right moment" is exercised at
// its exact severity boundary, not just "fires or does not".

import { expect, test } from 'vitest';
import { minorUnits, NO_MINOR_UNITS } from '$lib/money';
import type { EvaluatedCeiling } from '$lib/server/fiscal/ceiling';
import type { Ceiling } from '$lib/server/fiscal/pack';
import {
	currentPeriodStart,
	detectAgentRunFailure,
	detectApprovalUnactioned,
	detectBackupFailure,
	detectBillablePeriodClosed,
	detectCeilingApproaching,
	detectContractExpiring,
	detectInvoiceOverdue,
	detectMailboxPollFailure,
	detectMirrorFailure,
	detectProposalPending,
	detectRenewalWindowOpen,
	detectWorkedWithoutApproval,
	detectYearEndOverrunRisk,
	type ContractDeadlineRow
} from './detectors';

const label = { en: 'Flat-rate cap', it: 'Massimale forfettario' };
const consequence = { en: 'Regime lost', it: 'Regime perso' };

function contractRow(overrides: Partial<ContractDeadlineRow> = {}): ContractDeadlineRow {
	return {
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		endsOn: '2026-09-06',
		renewalType: 'none',
		renewalNoticeDays: null,
		...overrides
	};
}

// ── contract_expiring ───────────────────────────────────────────────────

test('contract_expiring does not fire further than the warning window', () => {
	const rows = [contractRow({ endsOn: '2026-09-07' })]; // 31 days from 2026-08-07
	expect(detectContractExpiring(rows, '2026-08-07')).toEqual([]);
});

test('contract_expiring fires warning exactly at the 30-day boundary', () => {
	const rows = [contractRow({ endsOn: '2026-09-06' })]; // exactly 30 days
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts).toHaveLength(1);
	expect(alerts[0].severity).toBe('warning');
});

test('contract_expiring fires serious exactly at the 14-day boundary', () => {
	const rows = [contractRow({ endsOn: '2026-08-21' })];
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts[0].severity).toBe('serious');
});

test('contract_expiring fires critical exactly at the 7-day boundary', () => {
	const rows = [contractRow({ endsOn: '2026-08-14' })];
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts[0].severity).toBe('critical');
});

test('contract_expiring fires with no renewal type at all — a fixed-term contract still needs to be seen ending', () => {
	const rows = [
		contractRow({ endsOn: '2026-08-10', renewalType: 'none', renewalNoticeDays: null })
	];
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts).toHaveLength(1);
});

test('contract_expiring stays critical once the end date has passed and nobody updated the contract', () => {
	const rows = [contractRow({ endsOn: '2026-07-01' })]; // 37 days ago
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts[0].severity).toBe('critical');
	expect(alerts[0].detail).toMatchObject({ daysUntilEnd: -37 });
});

test('contract_expiring key is stable per contract, independent of severity', () => {
	const rows = [contractRow({ contractId: 'c-9', endsOn: '2026-08-10' })];
	const alerts = detectContractExpiring(rows, '2026-08-07');
	expect(alerts[0].key).toBe('contract_expiring:c-9');
});

// ── renewal_window_open ─────────────────────────────────────────────────

test('renewal_window_open never fires for renewalType "none"', () => {
	const rows = [
		contractRow({ endsOn: '2026-08-08', renewalType: 'none', renewalNoticeDays: null })
	];
	expect(detectRenewalWindowOpen(rows, '2026-08-07')).toEqual([]);
});

test('renewal_window_open does not fire before the notice window opens', () => {
	const rows = [
		contractRow({ endsOn: '2026-09-30', renewalType: 'tacit', renewalNoticeDays: 30 }) // opens 2026-08-31
	];
	expect(detectRenewalWindowOpen(rows, '2026-08-07')).toEqual([]);
});

test('renewal_window_open fires the day the notice window opens, not before', () => {
	const rows = [contractRow({ endsOn: '2026-09-06', renewalType: 'tacit', renewalNoticeDays: 30 })];
	expect(detectRenewalWindowOpen(rows, '2026-08-06')).toEqual([]);
	const alerts = detectRenewalWindowOpen(rows, '2026-08-07');
	expect(alerts).toHaveLength(1);
	expect(alerts[0].detail).toMatchObject({ renewalType: 'tacit' });
});

test('renewal_window_open stops firing once the end date itself has passed', () => {
	const rows = [
		contractRow({ endsOn: '2026-08-01', renewalType: 'explicit', renewalNoticeDays: 60 })
	];
	expect(detectRenewalWindowOpen(rows, '2026-08-07')).toEqual([]);
});

test('renewal_window_open fires for counterparty_option and explicit too', () => {
	const rows = [
		contractRow({
			contractId: 'c-explicit',
			endsOn: '2026-08-14',
			renewalType: 'explicit',
			renewalNoticeDays: 10
		}),
		contractRow({
			contractId: 'c-option',
			endsOn: '2026-08-14',
			renewalType: 'counterparty_option',
			renewalNoticeDays: 10
		})
	];
	const alerts = detectRenewalWindowOpen(rows, '2026-08-07');
	expect(alerts.map((a) => a.key).sort()).toEqual([
		'renewal_window_open:c-explicit',
		'renewal_window_open:c-option'
	]);
});

// ── worked_without_approval ─────────────────────────────────────────────

function workedWithoutApprovalRow(sinceAt: string) {
	return {
		workUnitId: 'wu-1',
		contractId: 'c-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		date: sinceAt.slice(0, 10),
		sinceAt
	};
}

test('worked_without_approval fires serious the instant it is reached, never warning', () => {
	const alerts = detectWorkedWithoutApproval(
		[workedWithoutApprovalRow('2026-08-04T09:00:00.000Z')],
		'2026-08-04'
	);
	expect(alerts).toEqual([
		expect.objectContaining({ key: 'worked_without_approval:wu-1', severity: 'serious' })
	]);
});

test('worked_without_approval escalates to critical once unresolved for WORKED_WITHOUT_APPROVAL_CRITICAL_DAYS — #229: Friday now does tell you Tuesday is still unapproved', () => {
	const row = workedWithoutApprovalRow('2026-08-04T09:00:00.000Z'); // entered the state on a Tuesday

	// Tuesday, freshly at risk: serious.
	expect(detectWorkedWithoutApproval([row], '2026-08-04')[0].severity).toBe('serious');
	// Two days later, still under the threshold: still serious, not re-escalated.
	expect(detectWorkedWithoutApproval([row], '2026-08-06')[0].severity).toBe('serious');
	// Friday, three days later: strictly higher rank, which is what clears
	// delivery dedup (`state.ts`'s `covers`) and raises it again.
	expect(detectWorkedWithoutApproval([row], '2026-08-07')[0].severity).toBe('critical');
});

test('worked_without_approval is empty once nothing is currently in that state', () => {
	expect(detectWorkedWithoutApproval([], '2026-08-07')).toEqual([]);
});

// ── approval_unactioned ─────────────────────────────────────────────────

function approvalRow(daysAgo: number) {
	const receivedAt = new Date('2026-08-07T00:00:00.000Z');
	receivedAt.setUTCDate(receivedAt.getUTCDate() - daysAgo);
	return {
		approvalId: 'approval-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		receivedAt
	};
}

test('approval_unactioned does not fire the same day, or two days later — arriving ahead of the work is normal', () => {
	expect(detectApprovalUnactioned([approvalRow(0)], '2026-08-07')).toEqual([]);
	expect(detectApprovalUnactioned([approvalRow(2)], '2026-08-07')).toEqual([]);
});

test('approval_unactioned fires warning exactly at 3 days', () => {
	const alerts = detectApprovalUnactioned([approvalRow(3)], '2026-08-07');
	expect(alerts[0].severity).toBe('warning');
});

test('approval_unactioned fires serious exactly at 7 days', () => {
	const alerts = detectApprovalUnactioned([approvalRow(7)], '2026-08-07');
	expect(alerts[0].severity).toBe('serious');
});

test('approval_unactioned fires critical exactly at 14 days', () => {
	const alerts = detectApprovalUnactioned([approvalRow(14)], '2026-08-07');
	expect(alerts[0].severity).toBe('critical');
});

// ── proposal_pending ──────────────────────────────────────────────────────

function proposalRow(daysAgo: number) {
	const createdAt = new Date('2026-08-07T00:00:00.000Z');
	createdAt.setUTCDate(createdAt.getUTCDate() - daysAgo);
	return {
		proposalId: 'proposal-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		createdAt
	};
}

test('proposal_pending does not fire the same day, or two days later', () => {
	expect(detectProposalPending([proposalRow(0)], '2026-08-07')).toEqual([]);
	expect(detectProposalPending([proposalRow(2)], '2026-08-07')).toEqual([]);
});

test('proposal_pending fires warning exactly at 3 days', () => {
	const alerts = detectProposalPending([proposalRow(3)], '2026-08-07');
	expect(alerts[0].severity).toBe('warning');
});

test('proposal_pending fires serious exactly at 7 days', () => {
	const alerts = detectProposalPending([proposalRow(7)], '2026-08-07');
	expect(alerts[0].severity).toBe('serious');
});

test('proposal_pending fires critical exactly at 14 days', () => {
	const alerts = detectProposalPending([proposalRow(14)], '2026-08-07');
	expect(alerts[0].severity).toBe('critical');
});

test('proposal_pending is empty once nothing is currently pending', () => {
	expect(detectProposalPending([], '2026-08-07')).toEqual([]);
});

// ── invoice_overdue ──────────────────────────────────────────────────────

function invoiceRow(overrides: { dueDate: string; settledOn?: string | null }) {
	return {
		invoiceId: 'invoice-1',
		invoiceNumber: '2026/1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		dueDate: overrides.dueDate,
		settledOn: overrides.settledOn ?? null,
		total: 120000,
		currency: 'EUR'
	};
}

test('invoice_overdue does not fire on the due date itself, or once paid', () => {
	expect(detectInvoiceOverdue([invoiceRow({ dueDate: '2026-08-07' })], '2026-08-07')).toEqual([]);
	expect(
		detectInvoiceOverdue(
			[invoiceRow({ dueDate: '2026-07-01', settledOn: '2026-07-15' })],
			'2026-08-07'
		)
	).toEqual([]);
});

test('invoice_overdue fires warning the day after the due date', () => {
	const alerts = detectInvoiceOverdue([invoiceRow({ dueDate: '2026-08-06' })], '2026-08-07');
	expect(alerts[0]).toMatchObject({ severity: 'warning', detail: { daysLate: 1 } });
});

test('invoice_overdue fires serious exactly at 8 days late', () => {
	const alerts = detectInvoiceOverdue([invoiceRow({ dueDate: '2026-07-30' })], '2026-08-07');
	expect(alerts[0].severity).toBe('serious');
});

test('invoice_overdue fires critical exactly at 31 days late', () => {
	const alerts = detectInvoiceOverdue([invoiceRow({ dueDate: '2026-07-07' })], '2026-08-07');
	expect(alerts[0].severity).toBe('critical');
});

// ── billable_period_closed ──────────────────────────────────────────────

test('currentPeriodStart is null for on_completion, and calendar-aligned otherwise', () => {
	expect(currentPeriodStart('on_completion', '2026-08-07')).toBeNull();
	expect(currentPeriodStart('monthly', '2026-08-07')).toBe('2026-08-01');
	expect(currentPeriodStart('quarterly', '2026-08-07')).toBe('2026-07-01');
	expect(currentPeriodStart('quarterly', '2026-11-30')).toBe('2026-10-01');
	expect(currentPeriodStart('annual', '2026-08-07')).toBe('2026-01-01');
});

test('billable_period_closed never fires for on_completion contracts', () => {
	const rows = [
		{
			contractId: 'c-1',
			clientId: 'client-1',
			contractTitle: 'One-off engagement',
			clientLegalName: 'Acme Srl',
			invoicingCadence: 'on_completion' as const,
			eligibleDates: ['2026-01-05']
		}
	];
	expect(detectBillablePeriodClosed(rows, '2026-08-07')).toEqual([]);
});

test('billable_period_closed does not fire while every eligible day is still inside the open period', () => {
	const rows = [
		{
			contractId: 'c-1',
			clientId: 'client-1',
			contractTitle: 'Monthly retainer',
			clientLegalName: 'Acme Srl',
			invoicingCadence: 'monthly' as const,
			eligibleDates: ['2026-08-02', '2026-08-05']
		}
	];
	expect(detectBillablePeriodClosed(rows, '2026-08-07')).toEqual([]);
});

test('billable_period_closed fires the moment a period boundary passes over an unbilled day', () => {
	const rows = [
		{
			contractId: 'c-1',
			clientId: 'client-1',
			contractTitle: 'Monthly retainer',
			clientLegalName: 'Acme Srl',
			invoicingCadence: 'monthly' as const,
			eligibleDates: ['2026-07-20', '2026-07-28', '2026-08-02']
		}
	];
	const alerts = detectBillablePeriodClosed(rows, '2026-08-01');
	expect(alerts).toHaveLength(1);
	expect(alerts[0].detail).toMatchObject({ periodEnd: '2026-07-31', dayCount: 2 });
});

test('billable_period_closed severity escalates the longer the closed period sits unbilled', () => {
	const rows = () => [
		{
			contractId: 'c-1',
			clientId: 'client-1',
			contractTitle: 'Monthly retainer',
			clientLegalName: 'Acme Srl',
			invoicingCadence: 'monthly' as const,
			eligibleDates: ['2026-01-05']
		}
	];
	// 2026-01-05 to 2026-02-01 is 27 days — still warning.
	expect(detectBillablePeriodClosed(rows(), '2026-02-01')[0].severity).toBe('warning');
	// Exactly 30 days: the serious boundary.
	expect(detectBillablePeriodClosed(rows(), '2026-02-04')[0].severity).toBe('serious');
	// Exactly 60 days (31-day January plus 28-day February plus one): critical.
	expect(detectBillablePeriodClosed(rows(), '2026-03-06')[0].severity).toBe('critical');
});

// ── ceiling_approaching ──────────────────────────────────────────────────

function ceiling(overrides: Partial<Ceiling> = {}): Ceiling {
	return {
		id: 'ceiling-1',
		origin: 'pack',
		label,
		basis: 'cash_received_calendar_year',
		perimeter: { kind: 'all_clients' },
		alertLevels: [
			{ ratio: 0.8, label },
			{ ratio: 0.95, label }
		],
		consequence,
		measure: 'absolute_amount',
		value: 8_500_000,
		...overrides
	} as Ceiling;
}

function evaluated(overrides: Partial<EvaluatedCeiling> = {}): EvaluatedCeiling {
	return {
		ceiling: ceiling(),
		period: { from: '2026-01-01', to: '2027-01-01' },
		currentValue: NO_MINOR_UNITS,
		limitValue: minorUnits(8_500_000),
		usageRatio: 0,
		crossed: false,
		activeAlertLevels: [],
		...overrides
	};
}

test('ceiling_approaching does not fire below every configured alert level', () => {
	const row = evaluated({
		currentValue: minorUnits(1_000_000),
		usageRatio: 0.12,
		activeAlertLevels: []
	});
	expect(detectCeilingApproaching([row])).toEqual([]);
});

test('ceiling_approaching fires warning once the lowest configured level is crossed', () => {
	const row = evaluated({
		currentValue: minorUnits(6_900_000),
		usageRatio: 0.81,
		activeAlertLevels: [{ ratio: 0.8, label }]
	});
	expect(detectCeilingApproaching([row])[0].severity).toBe('warning');
});

test('ceiling_approaching fires serious past the 0.9 usage ratio', () => {
	const row = evaluated({
		currentValue: minorUnits(8_100_000),
		usageRatio: 0.9529411764705882,
		activeAlertLevels: [
			{ ratio: 0.8, label },
			{ ratio: 0.95, label }
		]
	});
	expect(detectCeilingApproaching([row])[0].severity).toBe('serious');
});

test('ceiling_approaching fires critical once actually crossed', () => {
	const row = evaluated({
		currentValue: minorUnits(8_600_000),
		usageRatio: 1.0117647058823529,
		crossed: true,
		activeAlertLevels: [
			{ ratio: 0.8, label },
			{ ratio: 0.95, label }
		]
	});
	expect(detectCeilingApproaching([row])[0].severity).toBe('critical');
});

test('ceiling_approaching carries the label and consequence bundles verbatim, for the renderer to pick a language from', () => {
	const row = evaluated({ activeAlertLevels: [{ ratio: 0.8, label }] });
	const [alert] = detectCeilingApproaching([row]);
	expect(alert.detail).toMatchObject({ ceilingLabel: label, consequence });
});

// ── year_end_overrun_risk ────────────────────────────────────────────────

test('year_end_overrun_risk does not fire when nothing projects past the limit', () => {
	const input = {
		evaluated: evaluated({ currentValue: minorUnits(1_000_000) }),
		committed: 500_000,
		projected: 200_000
	};
	expect(detectYearEndOverrunRisk([input])).toEqual([]);
});

test('year_end_overrun_risk does not duplicate an already-crossed ceiling — ceiling_approaching already covers it', () => {
	const input = {
		evaluated: evaluated({ currentValue: minorUnits(9_000_000), crossed: true }),
		committed: 1_000_000,
		projected: 0
	};
	expect(detectYearEndOverrunRisk([input])).toEqual([]);
});

test('year_end_overrun_risk fires once committed plus projected would land past the limit, even though nothing has crossed yet', () => {
	const input = {
		evaluated: evaluated({
			currentValue: minorUnits(5_000_000),
			limitValue: minorUnits(8_500_000)
		}),
		committed: 2_000_000,
		projected: 1_600_000 // total 8,600,000 > 8,500,000
	};
	const alerts = detectYearEndOverrunRisk([input]);
	expect(alerts).toHaveLength(1);
	expect(alerts[0].detail).toMatchObject({ projectedValue: 8_600_000, limitValue: 8_500_000 });
});

test('year_end_overrun_risk severity scales with how far past the limit the projection lands', () => {
	const base = { currentValue: NO_MINOR_UNITS, limitValue: minorUnits(1_000_000) };
	const warning = detectYearEndOverrunRisk([
		{ evaluated: evaluated(base), committed: 1_010_000, projected: 0 }
	]);
	const serious = detectYearEndOverrunRisk([
		{ evaluated: evaluated(base), committed: 1_100_000, projected: 0 }
	]);
	const critical = detectYearEndOverrunRisk([
		{ evaluated: evaluated(base), committed: 1_300_000, projected: 0 }
	]);
	expect(warning[0].severity).toBe('warning');
	expect(serious[0].severity).toBe('serious');
	expect(critical[0].severity).toBe('critical');
});

// ── backup_failure ───────────────────────────────────────────────────────

const asOf = new Date('2026-08-07T12:00:00.000Z');

test('backup_failure fires critical when no backup has ever run', () => {
	const alerts = detectBackupFailure(null, asOf);
	expect(alerts).toEqual([
		expect.objectContaining({
			key: 'backup_failure:global',
			severity: 'critical',
			detail: expect.objectContaining({ reason: 'never_run' })
		})
	]);
});

test('backup_failure fires critical, with the recorded detail, on an explicit failure — even a recent one', () => {
	const alerts = detectBackupFailure(
		{
			status: 'failure',
			detail: 'pg_dump exited 1',
			createdAt: new Date('2026-08-07T11:00:00.000Z')
		},
		asOf
	);
	expect(alerts[0]).toMatchObject({
		severity: 'critical',
		detail: { reason: 'failure', detail: 'pg_dump exited 1' }
	});
});

test('backup_failure fires serious once a successful run is more than 26 hours stale, not before', () => {
	const stillFresh = detectBackupFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-06T11:00:00.000Z') }, // 25h ago
		asOf
	);
	expect(stillFresh).toEqual([]);

	const stale = detectBackupFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-06T09:00:00.000Z') }, // 27h ago
		asOf
	);
	expect(stale[0]).toMatchObject({ severity: 'serious', detail: { reason: 'stale' } });
});

test('backup_failure is silent once a recent success is on file', () => {
	const alerts = detectBackupFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T10:00:00.000Z') },
		asOf
	);
	expect(alerts).toEqual([]);
});

// ── mirror_failure ───────────────────────────────────────────────────────

test('mirror_failure fires critical with the recorded detail on an explicit failure', () => {
	const alerts = detectMirrorFailure(
		[
			{
				documentId: 'doc-1',
				contractId: 'contract-1',
				clientId: 'client-1',
				contractTitle: 'Consulting agreement',
				clientLegalName: 'Acme Srl',
				createdAt: new Date('2026-08-07T11:30:00.000Z'),
				latestRun: {
					status: 'failure',
					detail: 'Drive quota exceeded',
					createdAt: new Date('2026-08-07T11:45:00.000Z')
				}
			}
		],
		asOf
	);
	expect(alerts[0]).toMatchObject({
		key: 'mirror_failure:doc-1',
		severity: 'critical',
		detail: { reason: 'failure', detail: 'Drive quota exceeded' }
	});
});

test('mirror_failure fires serious once a document has sat unmirrored, with no attempt, past the grace period', () => {
	const alerts = detectMirrorFailure(
		[
			{
				documentId: 'doc-1',
				contractId: 'contract-1',
				clientId: 'client-1',
				contractTitle: 'Consulting agreement',
				clientLegalName: 'Acme Srl',
				createdAt: new Date('2026-08-06T09:00:00.000Z'), // 27h ago
				latestRun: null
			}
		],
		asOf
	);
	expect(alerts[0]).toMatchObject({ severity: 'serious', detail: { reason: 'stale' } });
});

test('mirror_failure is silent within the grace period when nothing has been attempted yet', () => {
	const alerts = detectMirrorFailure(
		[
			{
				documentId: 'doc-1',
				contractId: 'contract-1',
				clientId: 'client-1',
				contractTitle: 'Consulting agreement',
				clientLegalName: 'Acme Srl',
				createdAt: new Date('2026-08-07T10:00:00.000Z'), // 2h ago
				latestRun: null
			}
		],
		asOf
	);
	expect(alerts).toEqual([]);
});

test('mirror_failure never sees a document that repository.ts already filtered out for having a remote file id — nothing to construct here proves it, the repository test does', () => {
	expect(detectMirrorFailure([], asOf)).toEqual([]);
});

// ── mailbox_poll_failure ─────────────────────────────────────────────────

test('mailbox_poll_failure is silent when polling is not configured, even with no run on file', () => {
	expect(detectMailboxPollFailure(false, null, asOf)).toEqual([]);
});

test('mailbox_poll_failure fires critical when configured but no poll has ever run', () => {
	const alerts = detectMailboxPollFailure(true, null, asOf);
	expect(alerts).toEqual([
		expect.objectContaining({
			key: 'mailbox_poll_failure:global',
			severity: 'critical',
			detail: expect.objectContaining({ reason: 'never_run' })
		})
	]);
});

test('mailbox_poll_failure fires critical, with the recorded detail, on an explicit failure — even a recent one', () => {
	const alerts = detectMailboxPollFailure(
		true,
		{
			status: 'failure',
			detail: 'connect ECONNREFUSED 127.0.0.1:993',
			createdAt: new Date('2026-08-07T11:55:00.000Z')
		},
		asOf
	);
	expect(alerts[0]).toMatchObject({
		severity: 'critical',
		detail: { reason: 'failure', detail: 'connect ECONNREFUSED 127.0.0.1:993' }
	});
});

test('mailbox_poll_failure fires serious once a successful run is more than 3 hours stale, not before', () => {
	const stillFresh = detectMailboxPollFailure(
		true,
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T09:30:00.000Z') }, // 2.5h ago
		asOf
	);
	expect(stillFresh).toEqual([]);

	const stale = detectMailboxPollFailure(
		true,
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T08:30:00.000Z') }, // 3.5h ago
		asOf
	);
	expect(stale[0]).toMatchObject({ severity: 'serious', detail: { reason: 'stale' } });
});

test('mailbox_poll_failure is silent once a recent success is on file', () => {
	const alerts = detectMailboxPollFailure(
		true,
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T11:00:00.000Z') },
		asOf
	);
	expect(alerts).toEqual([]);
});

// ── agent_run_failure ────────────────────────────────────────────────────

test('agent_run_failure fires critical when no run has ever been recorded', () => {
	const alerts = detectAgentRunFailure(null, asOf);
	expect(alerts).toEqual([
		expect.objectContaining({
			key: 'agent_run_failure:global',
			severity: 'critical',
			detail: expect.objectContaining({ reason: 'never_run' })
		})
	]);
});

test('agent_run_failure fires critical, with the recorded detail, on an explicit failure — even a recent one', () => {
	const alerts = detectAgentRunFailure(
		{ status: 'failure', detail: 'ENOTFOUND db', createdAt: new Date('2026-08-07T11:00:00.000Z') },
		asOf
	);
	expect(alerts[0]).toMatchObject({
		severity: 'critical',
		detail: { reason: 'failure', detail: 'ENOTFOUND db' }
	});
});

// The property #222's acceptance bullet asks for directly: a job that
// stops running — no exception, nothing to record a failure row, just
// silence — still surfaces as an alert once it has been quiet longer
// than a healthy schedule ever would be.
test('agent_run_failure fires serious once a successful run is more than 3 hours stale, not before — stopping the scheduler raises an alert', () => {
	const stillFresh = detectAgentRunFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T09:00:00.000Z') }, // 3h ago
		asOf
	);
	expect(stillFresh).toEqual([]);

	const stale = detectAgentRunFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T08:30:00.000Z') }, // 3.5h ago
		asOf
	);
	expect(stale[0]).toMatchObject({ severity: 'serious', detail: { reason: 'stale' } });
});

test('agent_run_failure is silent once a recent success is on file', () => {
	const alerts = detectAgentRunFailure(
		{ status: 'success', detail: null, createdAt: new Date('2026-08-07T11:00:00.000Z') },
		asOf
	);
	expect(alerts).toEqual([]);
});
