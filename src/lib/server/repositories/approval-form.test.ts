import { expect, test } from 'vitest';
import { parseApprovalForm } from './approval-form';

const CHANNELS = ['email', 'certified_mail', 'registered_mail', 'courier', 'other'] as const;

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	channel: 'other',
	sender: 'client (phone call)',
	receivedAt: '2026-06-04T09:00',
	excerpt: 'Confirmed by phone: go ahead with the three days.'
};

test('accepts a valid submission with pasted text as the proof', () => {
	const data = formData({ ...validBase, proofText: 'Call notes: approved.' });
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.proof).toBe('text');
	expect(result.input.channel).toBe('other');
	expect(result.input.origin).toEqual({ kind: 'manual' });
});

test('accepts a valid submission with an uploaded file as the proof', () => {
	const data = formData(validBase);
	data.set('proofFile', new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }));
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.proof).toBe('file');
});

test('rejects a channel outside the schema enum, not a hand-typed list', () => {
	const data = formData({
		...validBase,
		channel: 'whatsapp',
		proofText: 'Call notes: approved.'
	});
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.channel).toBeDefined();
});

test('rejects a submission with neither a file nor pasted text', () => {
	const result = parseApprovalForm(formData(validBase), CHANNELS);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.proof).toBeDefined();
});

test('rejects a submission with both a file and pasted text — exactly one proof, never both', () => {
	const data = formData({ ...validBase, proofText: 'Call notes: approved.' });
	data.set('proofFile', new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }));
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.proof).toBeDefined();
});

test('rejects a missing excerpt', () => {
	const data = formData({ ...validBase, excerpt: '', proofText: 'Call notes: approved.' });
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.excerpt).toBeDefined();
});

test('rejects an unparseable received-at value', () => {
	const data = formData({
		...validBase,
		receivedAt: 'not-a-date',
		proofText: 'Call notes: approved.'
	});
	const result = parseApprovalForm(data, CHANNELS);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.receivedAt).toBeDefined();
});
