import { expect, test } from 'vitest';
import { parseEmailTemplateForm } from './email-template-form';

function formData(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			for (const item of value) data.append(key, item);
		} else {
			data.set(key, value);
		}
	}
	return data;
}

test('a valid manual template with both attachment kinds parses cleanly', () => {
	const result = parseEmailTemplateForm(
		formData({
			contractId: 'contract-1',
			name: 'Invoice cover note',
			subject: 'Invoice {{invoice_number}}',
			body: 'Please find attached. Total: {{amount}}.',
			attachmentKinds: ['day_register_pdf', 'day_register_csv'],
			triggerKind: 'manual',
			triggerDays: ''
		})
	);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.input).toEqual({
		contractId: 'contract-1',
		name: 'Invoice cover note',
		subject: 'Invoice {{invoice_number}}',
		body: 'Please find attached. Total: {{amount}}.',
		attachmentKinds: ['day_register_pdf', 'day_register_csv'],
		trigger: { kind: 'manual' }
	});
});

test('an unknown placeholder fails validation and names the placeholder', () => {
	const result = parseEmailTemplateForm(
		formData({
			contractId: 'contract-1',
			name: 'Bad template',
			subject: 'Hello {{client_name}}',
			body: 'Body',
			triggerKind: 'manual',
			triggerDays: ''
		})
	);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.placeholders).toContain('client_name');
});

test('days_before_due requires a positive integer day count', () => {
	const invalid = parseEmailTemplateForm(
		formData({
			contractId: 'contract-1',
			name: 'Reminder',
			subject: 'Subject',
			body: 'Body',
			triggerKind: 'days_before_due',
			triggerDays: '-1'
		})
	);
	expect(invalid.ok).toBe(false);

	const valid = parseEmailTemplateForm(
		formData({
			contractId: 'contract-1',
			name: 'Reminder',
			subject: 'Subject',
			body: 'Body',
			triggerKind: 'days_before_due',
			triggerDays: '5'
		})
	);
	expect(valid.ok).toBe(true);
	if (!valid.ok) return;
	expect(valid.input.trigger).toEqual({ kind: 'days_before_due', days: 5 });
});

test('an attachment kind outside the known set is dropped rather than accepted', () => {
	const result = parseEmailTemplateForm(
		formData({
			contractId: 'contract-1',
			name: 'Template',
			subject: 'Subject',
			body: 'Body',
			attachmentKinds: ['invoice_pdf', 'day_register_pdf'],
			triggerKind: 'manual',
			triggerDays: ''
		})
	);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.input.attachmentKinds).toEqual(['day_register_pdf']);
});

test('a missing name, subject and body are all reported together', () => {
	const result = parseEmailTemplateForm(
		formData({ contractId: 'contract-1', triggerKind: 'manual', triggerDays: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(Object.keys(result.errors).sort()).toEqual(['body', 'name', 'subject']);
});
