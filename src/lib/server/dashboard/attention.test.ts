import { expect, test } from 'vitest';
import type { ActiveAlert } from '$lib/server/alerts/engine';
import { makeAlert, type Alert } from '$lib/server/alerts/types';
import { buildAttentionRows, type AttentionRow } from './attention';

function active(alert: Alert): ActiveAlert {
	return {
		...alert,
		acknowledged: false,
		acknowledgedAt: null,
		acknowledgedBy: null,
		delivered: false
	};
}

const wwa = active(
	makeAlert('wu-1', 'critical', {
		type: 'worked_without_approval',
		workUnitId: 'wu-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Contratto quadro 2026',
		clientLegalName: 'Nordwind Logistics S.p.A.',
		date: '2026-07-21',
		sinceAt: '2026-07-21T00:00:00Z'
	})
);

const invoiceOverdue = active(
	makeAlert('invoice-1', 'critical', {
		type: 'invoice_overdue',
		invoiceId: 'invoice-1',
		invoiceNumber: '2026/011',
		contractTitle: 'Contratto continuativo',
		clientLegalName: 'Bellani & Partners',
		dueDate: '2026-07-10',
		daysLate: 34,
		total: 264_740,
		currency: 'EUR'
	})
);

const ceilingApproaching = active(
	makeAlert('ceiling-1', 'warning', {
		type: 'ceiling_approaching',
		ceilingId: 'ceiling-1',
		ceilingLabel: { en: 'Flat-rate revenue ceiling', it: 'Soglia di ricavi' },
		consequence: { en: 'Loses the regime', it: 'Perde il regime' },
		usageRatio: 0.82,
		currentValue: 6_970_000,
		limitValue: 8_500_000
	})
);

// Not one of the queue's named types — stays /alerts-only.
const contractExpiring = active(
	makeAlert('contract-1', 'critical', {
		type: 'contract_expiring',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Contratto',
		clientLegalName: 'Nordwind',
		endsOn: '2026-08-01',
		daysUntilEnd: -5
	})
);

test('only the four named attention alert types are included, in the input order (already severity-sorted upstream)', () => {
	const rows = buildAttentionRows(
		[wwa, invoiceOverdue, ceilingApproaching, contractExpiring],
		'en',
		null
	);
	expect(rows.map((r) => r.key)).toEqual([wwa.key, invoiceOverdue.key, ceilingApproaching.key]);
});

test('every included row carries the same link/action alertResolution gives /alerts, never a second mapping', () => {
	const rows = buildAttentionRows([wwa], 'en', null);
	expect(rows[0].subjectHref).toBe('/day/wu-1');
	expect(rows[0].actionHref).toBe('/approvals/new?contractId=contract-1&workUnitId=wu-1');
	expect(rows[0].severity).toBe('critical');
});

test('a pending-proposals row, when given, is appended last with its own info severity', () => {
	const proposalsRow: AttentionRow = {
		key: 'pending-proposals',
		severity: 'info',
		title: '2 pending proposals',
		body: '17 Aug (1 day) and 18 Aug (0.5 days)',
		subjectHref: '/proposals',
		subjectLabel: 'Review',
		actionHref: '/proposals',
		actionLabel: 'Review'
	};
	const rows = buildAttentionRows([wwa, invoiceOverdue], 'en', proposalsRow);
	expect(rows.at(-1)).toBe(proposalsRow);
	expect(rows).toHaveLength(3);
});

test('no matching alerts and no proposals row is an empty queue, not an empty-state row', () => {
	expect(buildAttentionRows([contractExpiring], 'en', null)).toEqual([]);
});
