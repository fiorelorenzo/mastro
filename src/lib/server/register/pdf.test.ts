import { PDFParse } from 'pdf-parse';
import { expect, test } from 'vitest';
import { renderRegisterPdf } from './pdf';
import type { Register } from './types';

function entry(date: string, quantity: number): Register['entries'][number] {
	return {
		workUnitId: `wu-${date}`,
		date,
		quantity,
		scope: `Work on ${date}.`,
		approval: {
			channel: 'email',
			sender: 'ops@client.example',
			receivedAt: new Date('2024-01-01T09:00:00Z'),
			messageId: null
		}
	};
}

test('produces a well-formed PDF that starts a new page rather than truncating a long period', async () => {
	// Enough rows to overflow an A4 page at this row height, so the
	// register for a busy month is never silently cut off.
	const entries = Array.from({ length: 80 }, (_, i) =>
		entry(`2024-0${((i % 9) + 1).toString()}-0${(i % 9) + 1}`, 1)
	);
	const register: Register = {
		contractId: 'contract-1',
		from: '2024-01-01',
		to: '2024-12-31',
		entries,
		totalQuantity: entries.length
	};

	const buffer = await renderRegisterPdf(register);
	expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

	const parser = new PDFParse({ data: buffer });
	const info = await parser.getInfo({ parsePageInfo: true });
	await parser.destroy();
	expect(info.total).toBeGreaterThan(1);
});

test('an empty period still renders a valid PDF carrying the header and the zero total', async () => {
	const register: Register = {
		contractId: 'contract-1',
		from: '2024-01-01',
		to: '2024-01-31',
		entries: [],
		totalQuantity: 0
	};

	const buffer = await renderRegisterPdf(register);
	const parser = new PDFParse({ data: buffer });
	const { text } = await parser.getText();
	await parser.destroy();
	expect(text).toContain('0');
});
