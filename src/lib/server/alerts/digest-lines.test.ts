// `digestLines`'s containment (#436), which is the half `dispatch.test.ts`
// structurally cannot reach: that file drives the whole digest against a
// real mailbox and a real database, and the alerts it gets back are built
// from columns that cannot hold a value which fails to render. So the
// failure path is only observable by handing the function one directly,
// which is exactly why it is exported.

import { expect, test } from 'vitest';
import { digestLines } from './dispatch';
import { makeAlert, type Alert } from './types';

function contractExpiring(endsOn: string): Alert {
	return makeAlert('contract-1', 'warning', {
		type: 'contract_expiring',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'Consulting agreement',
		clientLegalName: 'Acme Srl',
		endsOn,
		daysUntilEnd: 20
	});
}

test('an alert that cannot be rendered costs its own line and nothing else', () => {
	// `'not-a-date'` is the shape that took the whole digest down: `Intl`
	// throws `RangeError` on an Invalid Date rather than returning anything
	// the caller might notice, so before this the weekly email never went
	// out at all and the route answered 500 to a timer nobody watches.
	const good = contractExpiring('2026-09-06');
	const bad = contractExpiring('not-a-date');

	const { lines, rendered, unrenderable } = digestLines([bad, good]);

	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain('Consulting agreement');
	expect(unrenderable).toHaveLength(1);
	expect(unrenderable[0].alertType).toBe('contract_expiring');
	// The log line has to be able to say which alert and why, or the next
	// one of these is an archaeology exercise rather than a grep.
	expect(unrenderable[0].alertKey.length).toBeGreaterThan(0);
	expect(unrenderable[0].detail.length).toBeGreaterThan(0);

	// And the one that failed is not among the alerts the caller will mark
	// delivered: dropping it from one email is a degradation, marking it
	// delivered would be data loss, because no later digest would offer it.
	expect(rendered).toHaveLength(1);
	expect(rendered[0].key).toBe(good.key);
});

test('every alert failing leaves nothing to send rather than an empty email', () => {
	const { lines, rendered, unrenderable } = digestLines([
		contractExpiring('not-a-date'),
		contractExpiring('also-not')
	]);

	expect(lines).toHaveLength(0);
	expect(rendered).toHaveLength(0);
	expect(unrenderable).toHaveLength(2);
});

test('the severest alert leads, so a digest is read in the order it matters', () => {
	// The sort was here before the containment was, and it has to survive
	// it: the loop now builds the lines rather than mapping over a sorted
	// copy, which is exactly the kind of refactor that silently drops an
	// ordering nobody asserted.
	const warning = makeAlert('contract-1', 'warning', {
		type: 'contract_expiring',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'The less urgent one',
		clientLegalName: 'Acme Srl',
		endsOn: '2026-09-06',
		daysUntilEnd: 20
	});
	const critical = makeAlert('wu-1', 'critical', {
		type: 'worked_without_approval',
		workUnitId: 'wu-1',
		contractId: 'contract-1',
		clientId: 'client-1',
		contractTitle: 'The urgent one',
		clientLegalName: 'Acme Srl',
		date: '2026-08-04',
		sinceAt: '2026-08-04T09:00:00.000Z'
	});

	const { lines } = digestLines([warning, critical]);

	expect(lines).toHaveLength(2);
	expect(lines[0]).toContain('The urgent one');
	expect(lines[1]).toContain('The less urgent one');
});
