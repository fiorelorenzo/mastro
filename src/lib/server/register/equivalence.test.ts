// #70's acceptance: "both formats carry identical figures", proved by
// comparing them rather than by eye. `pdf-parse` (pure JS, built on
// pdf.js's core — no headless browser) extracts the PDF's text back out;
// every figure the CSV carries is checked against that extracted text.
import { PDFParse } from 'pdf-parse';
import { expect, test } from 'vitest';
import { formatApprovalReference } from './format';
import { renderRegisterCsv } from './csv';
import { renderRegisterPdf } from './pdf';
import type { Register } from './types';

const register: Register = {
	contractId: 'contract-1',
	from: '2024-03-01',
	to: '2024-03-31',
	entries: [
		{
			workUnitId: 'wu-1',
			date: '2024-03-05',
			quantity: 0.5,
			scope: 'Half day of QA on the billing module.',
			approval: {
				channel: 'email',
				sender: 'ops@client.example',
				receivedAt: new Date('2024-03-01T09:00:00Z'),
				messageId: '<abc@example.com>'
			}
		},
		{
			workUnitId: 'wu-2',
			date: '2024-03-20',
			quantity: 1,
			scope: 'On-site kickoff and handover.',
			approval: {
				channel: 'certified_mail',
				sender: 'legal@client.example',
				receivedAt: new Date('2024-03-15T09:00:00Z'),
				messageId: null
			}
		}
	],
	totalQuantity: 1.5
};

test('the PDF carries every figure the CSV carries: dates, quantities, scopes, approval references and the total', async () => {
	const csv = renderRegisterCsv(register);
	const pdfBuffer = await renderRegisterPdf(register);

	const parser = new PDFParse({ data: pdfBuffer });
	const { text: pdfText } = await parser.getText();
	await parser.destroy();

	// Cell wrapping inside a column is a layout decision, not a figure —
	// `pdf-parse` reports each wrapped line as its own line break, so
	// whitespace (including those breaks) is collapsed before comparing,
	// the same way a person reading the PDF would not see a wrapped
	// approval reference as a different value from an unwrapped one.
	const normalizedPdfText = pdfText.replace(/\s+/g, ' ');

	// Every CSV data row (skip the header and the totals row, checked
	// separately below) reduces to the figures this asserts one by one,
	// so a mismatch names exactly which figure diverged.
	for (const entry of register.entries) {
		expect(csv).toContain(entry.date);
		expect(normalizedPdfText).toContain(entry.date);

		expect(csv).toContain(String(entry.quantity));
		expect(normalizedPdfText).toContain(String(entry.quantity));

		expect(csv).toContain(entry.scope);
		expect(normalizedPdfText).toContain(entry.scope);

		const reference = formatApprovalReference(entry.approval);
		expect(csv).toContain(reference);
		expect(normalizedPdfText).toContain(reference);
	}

	expect(csv).toContain(String(register.totalQuantity));
	expect(normalizedPdfText).toContain(String(register.totalQuantity));
});
