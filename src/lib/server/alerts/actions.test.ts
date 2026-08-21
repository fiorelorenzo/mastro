// #220's acceptance bullet, proven directly: every alert kind the engine
// can raise has a link and a primary action. `FIXTURES` is keyed by
// `Record<AlertType, AlertDetail>` — dropping a case there, same as in
// `alertResolution` itself, is a compile error, so `ALERT_TYPES` widening
// without a fixture cannot silently pass this file.

import { expect, test } from 'vitest';
import { alertResolution } from './actions';
import { ALERT_TYPES, type AlertDetail, type AlertType } from './types';

const label = { en: 'Flat-rate cap', it: 'Massimale forfettario' };
const consequence = { en: 'Regime lost', it: 'Regime perso' };

const FIXTURES: Record<AlertType, AlertDetail> = {
	contract_expiring: {
		type: 'contract_expiring',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		endsOn: '2026-09-06',
		daysUntilEnd: 20
	},
	renewal_window_open: {
		type: 'renewal_window_open',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		endsOn: '2026-09-06',
		renewalType: 'explicit',
		daysUntilEnd: 10
	},
	worked_without_approval: {
		type: 'worked_without_approval',
		workUnitId: 'wu-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		date: '2026-08-01',
		sinceAt: '2026-08-01T09:00:00.000Z'
	},
	approval_unactioned: {
		type: 'approval_unactioned',
		approvalId: 'approval-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		receivedAt: '2026-08-01T09:00:00.000Z',
		daysUnactioned: 5
	},
	proposal_pending: {
		type: 'proposal_pending',
		proposalId: 'proposal-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		createdAt: '2026-08-01T09:00:00.000Z',
		daysPending: 5
	},
	invoice_overdue: {
		type: 'invoice_overdue',
		invoiceId: 'invoice-1',
		invoiceNumber: '2026/011',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		dueDate: '2026-07-10',
		daysLate: 34,
		total: 264_740,
		currency: 'EUR'
	},
	billable_period_closed: {
		type: 'billable_period_closed',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		periodEnd: '2026-07-31',
		dayCount: 2
	},
	ceiling_approaching: {
		type: 'ceiling_approaching',
		ceilingId: 'ceiling-1',
		ceilingLabel: label,
		consequence,
		usageRatio: 0.85,
		currentValue: 85_000,
		limitValue: 100_000
	},
	year_end_overrun_risk: {
		type: 'year_end_overrun_risk',
		ceilingId: 'ceiling-1',
		ceilingLabel: label,
		consequence,
		projectedValue: 120_000,
		limitValue: 100_000,
		periodEnd: '2026-12-31'
	},
	backup_failure: {
		type: 'backup_failure',
		reason: 'failure',
		detail: 'disk full',
		lastRunAt: '2026-08-01T03:00:00.000Z'
	},
	mirror_failure: {
		type: 'mirror_failure',
		documentId: 'doc-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		reason: 'failure',
		detail: 'quota exceeded',
		since: '2026-08-01T03:00:00.000Z'
	},
	mailbox_poll_failure: {
		type: 'mailbox_poll_failure',
		reason: 'failure',
		detail: 'auth expired',
		lastRunAt: '2026-08-01T03:00:00.000Z'
	},
	agent_run_failure: {
		type: 'agent_run_failure',
		reason: 'failure',
		detail: 'ENOTFOUND db',
		lastRunAt: '2026-08-01T03:00:00.000Z'
	},
	recorded_day_contradicted: {
		type: 'recorded_day_contradicted',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		date: '2026-08-04',
		workUnitId: 'work-unit-1',
		recordedQuantity: 1,
		readingQuantity: 0.5
	},
	pending_proposal_unconfirmed: {
		type: 'pending_proposal_unconfirmed',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		date: '2026-08-04',
		proposalId: 'proposal-1'
	}
};

test('every alert kind the engine can raise resolves to a real link and a real action', () => {
	expect(ALERT_TYPES.length).toBeGreaterThan(0);
	for (const type of ALERT_TYPES) {
		const resolution = alertResolution(FIXTURES[type], 'en');
		// A real, absolute, in-app path — never empty, never a bare `#`.
		expect(resolution.subjectHref, type).toMatch(/^\//);
		expect(resolution.actionHref, type).toMatch(/^\//);
		expect(resolution.subjectLabel.length, type).toBeGreaterThan(0);
		expect(resolution.actionLabel.length, type).toBeGreaterThan(0);
		// "Resolving" is never phrased as acknowledging — that stays a
		// separate, tertiary action on the page itself.
		expect(resolution.actionLabel.toLowerCase(), type).not.toContain('acknowledge');
	}
});

test('worked_without_approval — the day at risk is one click from the form that fixes it: the action drafts the missing approval and links it to this exact day', () => {
	const resolution = alertResolution(FIXTURES.worked_without_approval, 'en');
	expect(resolution.subjectHref).toBe('/day/wu-1');
	expect(resolution.actionHref).toBe('/approvals/new?contractId=contract-1&workUnitId=wu-1');
	expect(resolution.actionLabel).toBe('Link an approval');
});

test("worked_without_approval — also carries #228's second exit, closing the day out as unbillable, present on no other alert kind", () => {
	const resolution = alertResolution(FIXTURES.worked_without_approval, 'en');
	expect(resolution.closeUnbillable).toEqual({ workUnitId: 'wu-1', label: 'Mark unbillable' });

	for (const type of ALERT_TYPES) {
		if (type === 'worked_without_approval') continue;
		expect(alertResolution(FIXTURES[type], 'en').closeUnbillable, type).toBeUndefined();
	}
});

test('invoice_overdue — subject opens the invoice by number, action opens its dunning reminder form', () => {
	const resolution = alertResolution(FIXTURES.invoice_overdue, 'it');
	expect(resolution.subjectHref).toBe('/invoices/invoice-1');
	expect(resolution.subjectLabel).toBe('Apri fattura 2026/011');
	expect(resolution.actionHref).toBe('/invoices/invoice-1/remind');
	expect(resolution.actionLabel).toBe('Invia un sollecito');
});

test('approval_unactioned — action prefills day/new with both the contract and the waiting approval', () => {
	const resolution = alertResolution(FIXTURES.approval_unactioned, 'en');
	expect(resolution.subjectHref).toBe('/clients/client-1/contracts/contract-1');
	expect(resolution.actionHref).toBe('/day/new?contractId=contract-1&approvalId=approval-1');
});

test('billable_period_closed — action opens invoice creation pre-scoped to the contract', () => {
	const resolution = alertResolution(FIXTURES.billable_period_closed, 'en');
	expect(resolution.actionHref).toBe('/invoices/new?contractId=contract-1');
});

test('contract_expiring and renewal_window_open both view the contract and act on its edit form', () => {
	for (const detail of [FIXTURES.contract_expiring, FIXTURES.renewal_window_open]) {
		const resolution = alertResolution(detail, 'en');
		expect(resolution.subjectHref).toBe('/clients/client-1/contracts/contract-1');
		expect(resolution.actionHref).toBe('/clients/client-1/contracts/contract-1/edit');
	}
});

test('the three system-health alerts and the two ceiling alerts collapse subject and action onto the one real screen each has', () => {
	expect(alertResolution(FIXTURES.backup_failure, 'en').actionHref).toBe('/settings');
	expect(alertResolution(FIXTURES.mailbox_poll_failure, 'en').actionHref).toBe('/settings');
	expect(alertResolution(FIXTURES.agent_run_failure, 'en').actionHref).toBe('/settings');
	expect(alertResolution(FIXTURES.ceiling_approaching, 'en').actionHref).toBe('/');
	expect(alertResolution(FIXTURES.year_end_overrun_risk, 'en').actionHref).toBe('/');
});

test('mirror_failure links to the contract that owns the unmirrored document, both as subject and as action', () => {
	const resolution = alertResolution(FIXTURES.mirror_failure, 'en');
	expect(resolution.subjectHref).toBe('/clients/client-1/contracts/contract-1');
	expect(resolution.actionHref).toBe('/clients/client-1/contracts/contract-1');
});

test('proposal_pending — subject and action both open the proposal review screen', () => {
	const resolution = alertResolution(FIXTURES.proposal_pending, 'en');
	expect(resolution.subjectHref).toBe('/proposals/proposal-1');
	expect(resolution.actionHref).toBe('/proposals/proposal-1');
});
