import { expect, test } from 'vitest';
import {
	acceptedToast,
	evidenceDocumentHint,
	evidenceHeading,
	notGroundedHint,
	proposalTargetTypes,
	rejectConfirmBody,
	rejectedToast,
	siblingPosition,
	viewResultLabel
} from './decision-wording';

/**
 * The defect these cover (#356) was a string that was right for one case
 * and shipped for all of them, so asserting the fixed case alone would miss
 * the next one. Every target type and both evidence families are named
 * here on purpose.
 */

test('each target type is announced as the thing that was actually written', () => {
	const byType = Object.fromEntries(proposalTargetTypes.map((t) => [t, acceptedToast(t)]));

	expect(byType.work_unit).toMatch(/day/i);
	expect(byType.contract).toMatch(/contract/i);
	expect(byType.invoice).toMatch(/invoice/i);
});

test('no two target types share an accept toast', () => {
	// The bug was one string serving three targets, so a regression is
	// exactly two of these collapsing back into one.
	const announced = proposalTargetTypes.map(acceptedToast);

	expect(new Set(announced).size).toBe(proposalTargetTypes.length);
});

test('accepting a contract does not claim a day was recorded', () => {
	expect(acceptedToast('contract')).not.toMatch(/day/i);
	expect(acceptedToast('invoice')).not.toMatch(/day/i);
});

test('evidence that is not mail is never called a message', () => {
	for (const wording of [evidenceHeading(false), rejectedToast(false), rejectConfirmBody(false)]) {
		expect(wording).not.toMatch(/message/i);
		expect(wording).toMatch(/document/i);
	}
});

test('evidence that is mail still reads as a message', () => {
	for (const wording of [evidenceHeading(true), rejectedToast(true), rejectConfirmBody(true)]) {
		expect(wording).toMatch(/message/i);
	}
});

test('both evidence families still promise the archive is untouched', () => {
	// The reason these strings exist (invariant 4): whichever noun they
	// use, the promise they carry has to survive the rewording.
	for (const fromMessage of [true, false]) {
		expect(rejectedToast(fromMessage)).toMatch(/archived as evidence/i);
		expect(rejectConfirmBody(fromMessage)).toMatch(/never reaches the ledger/i);
	}
});

test('the evidence promise names what the document is attached to', () => {
	expect(evidenceDocumentHint('work_unit')).toMatch(/the day/i);
	expect(evidenceDocumentHint('contract')).toMatch(/the contract/i);
	expect(evidenceDocumentHint('invoice')).toMatch(/the invoice/i);
	// Whichever noun, the promise itself has to survive (invariant 4).
	for (const t of proposalTargetTypes) {
		expect(evidenceDocumentHint(t)).toMatch(/never unlinks/i);
	}
});

test('an ungrounded field blames the kind of source it actually had', () => {
	expect(notGroundedHint(true)).toMatch(/message/i);
	expect(notGroundedHint(false)).toMatch(/document/i);
	expect(notGroundedHint(false)).not.toMatch(/message/i);
});

test('siblings come from a document unless that document is a message', () => {
	const at = { index: 2, count: 5 };
	expect(siblingPosition(true, at)).toMatch(/message/i);
	expect(siblingPosition(false, at)).toMatch(/document/i);
	// The position itself must still interpolate in both.
	for (const fromMessage of [true, false]) {
		expect(siblingPosition(fromMessage, at)).toContain('2');
		expect(siblingPosition(fromMessage, at)).toContain('5');
	}
});

test('the queue names the result it links to, one label per kind', () => {
	const labels = (['work_unit', 'contract', 'invoice'] as const).map(viewResultLabel);

	expect(labels[0]).toMatch(/day/i);
	expect(labels[1]).toMatch(/contract/i);
	expect(labels[2]).toMatch(/invoice/i);
	// The bug was one label for all three destinations.
	expect(new Set(labels).size).toBe(3);
});
