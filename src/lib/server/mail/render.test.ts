import { expect, test } from 'vitest';
import type { Register } from '$lib/server/register/types';
import { renderTemplate, type EmailTemplateContext } from './render';

const register: Register = {
	contractId: 'contract-1',
	from: '2024-03-01',
	to: '2024-03-31',
	entries: [
		{
			workUnitId: 'wu-1',
			date: '2024-03-05',
			quantity: 1,
			scope: 'Work.',
			approval: {
				channel: 'email',
				sender: 'ops@client.example',
				receivedAt: new Date('2024-03-01T09:00:00Z'),
				messageId: null
			}
		}
	],
	totalQuantity: 1
};

const context: EmailTemplateContext = {
	invoice: { number: 'INV-2024-03', total: 150000, currency: 'EUR', dueDate: '2024-04-30' },
	period: { from: '2024-03-01', to: '2024-03-31' },
	register
};

test('renders every known placeholder with real, formatted data', () => {
	const rendered = renderTemplate(
		{
			subject: 'Invoice {{invoice_number}} — {{period}}',
			body: '{{amount}} due {{due_date}}. Days: {{day_list}} ({{day_total}}).'
		},
		context
	);

	expect(rendered.subject).toBe('Invoice INV-2024-03 — Mar 1, 2024 – Mar 31, 2024');
	expect(rendered.body).toBe('€1,500.00 due Apr 30, 2024. Days: Mar 5, 2024 (1 day).');
	expect(rendered.subject).not.toMatch(/\{\{/);
	expect(rendered.body).not.toMatch(/\{\{/);
});

test('a template using none of the placeholders renders unchanged', () => {
	const rendered = renderTemplate({ subject: 'Fixed subject', body: 'Fixed body.' }, context);
	expect(rendered).toEqual({ subject: 'Fixed subject', body: 'Fixed body.' });
});
