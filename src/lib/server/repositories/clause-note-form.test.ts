import { expect, test } from 'vitest';
import { parseClauseNoteForm } from './clause-note-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	clauseReference: 'Art. 8.3',
	verbatimText: 'The agreement terminates unless renewed by either party.',
	interpretationAdopted: 'Read as counterparty_option, per client confirmation.',
	notes: ''
};

test('accepts a valid submission', () => {
	const result = parseClauseNoteForm(formData(validBase));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.notes).toBeNull();
});

test('keeps free notes when supplied', () => {
	const result = parseClauseNoteForm(formData({ ...validBase, notes: 'Confirmed by email.' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.notes).toBe('Confirmed by email.');
});

test('rejects a missing clause reference', () => {
	const result = parseClauseNoteForm(formData({ ...validBase, clauseReference: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.clauseReference).toBeDefined();
});

test('rejects a missing interpretation', () => {
	const result = parseClauseNoteForm(formData({ ...validBase, interpretationAdopted: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.interpretationAdopted).toBeDefined();
});
