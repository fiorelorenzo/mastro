import { expect, test } from 'vitest';
import { renderRegisterCsv } from './csv';
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
			scope: 'Half day of QA.',
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
			// Scope contains a comma, a quote and a newline: the three
			// characters RFC 4180 requires quoting for.
			quantity: 1,
			scope: 'On-site, "kickoff"\nand handover.',
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

test('renders a header row, one row per entry, and a totals row', () => {
	const rows = renderRegisterCsv(register).split('\r\n').filter(Boolean);
	expect(rows).toHaveLength(4);
	expect(rows[0]).toBe('Date,Quantity,Scope,Approval');
	expect(rows[1]).toBe(
		'2024-03-05,0.5,Half day of QA.,email · ops@client.example · 2024-03-01 · <abc@example.com>'
	);
	expect(rows[3]).toBe(',1.5,Total,');
});

test('quotes a field containing a comma, a quote or a newline, doubling embedded quotes', () => {
	const rows = renderRegisterCsv(register).split('\r\n').filter(Boolean);
	expect(rows[2]).toBe(
		'2024-03-20,1,"On-site, ""kickoff""\nand handover.",certified_mail · legal@client.example · 2024-03-15'
	);
});
