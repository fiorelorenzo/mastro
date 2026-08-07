import { expect, test } from 'vitest';
import { formatDays } from '$lib/i18n/format';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import { daysLate } from '$lib/server/domain/invoice';
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
	register,
	language: 'en'
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

test('substitutes days_late, derived live from the invoice due date — never a stored figure (#73, #27)', () => {
	const overdueDueDate = '2020-01-15';
	const rendered = renderTemplate(
		{ subject: 'Reminder', body: 'Overdue by {{days_late}}.' },
		{ ...context, invoice: { ...context.invoice, dueDate: overdueDueDate } }
	);
	const expected = formatDays(daysLate(overdueDueDate), 'en');
	expect(rendered.body).toBe(`Overdue by ${expected}.`);
});

// #69's acceptance: a contract's template renders in its own language
// regardless of the interface language. `overwriteGetLocale` simulates
// switching the active UI locale the way `setLocale` would in a real
// request — `renderTemplate` must never notice, because `context.language`
// is always passed explicitly to every format call, never left to default
// to whoever is signed in.
test("a contract's template renders in its own language under both UI locales (#69)", () => {
	const template = {
		subject: 'Invoice {{invoice_number}} — {{period}}',
		body: '{{amount}} due {{due_date}}.'
	};
	const italianContractContext: EmailTemplateContext = { ...context, language: 'it' };
	const originalGetLocale = getLocale;

	try {
		overwriteGetLocale(() => 'en');
		const renderedUnderEnglishUi = renderTemplate(template, italianContractContext);

		overwriteGetLocale(() => 'it');
		const renderedUnderItalianUi = renderTemplate(template, italianContractContext);

		const expectedInItalian = {
			subject: 'Invoice INV-2024-03 — 1 mar 2024 – 31 mar 2024',
			body: '1500,00\u00a0€ due 30 apr 2024.'
		};

		expect(renderedUnderEnglishUi).toEqual(expectedInItalian);
		expect(renderedUnderItalianUi).toEqual(expectedInItalian);
		expect(renderedUnderEnglishUi).toEqual(renderedUnderItalianUi);
	} finally {
		overwriteGetLocale(originalGetLocale);
	}
});
