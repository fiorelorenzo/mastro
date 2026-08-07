// The day register as CSV (#70). RFC 4180: CRLF row endings, fields quoted
// only when they contain the delimiter, a quote or a line break, and an
// embedded quote doubled. `scope` is free text a human typed, so it is the
// one field here that can contain any of the three.
import * as m from '$lib/paraglide/messages';
import { formatApprovalReference } from './format';
import type { Register } from './types';

function csvField(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: readonly string[]): string {
	return fields.map(csvField).join(',');
}

/** Renders `register` as CSV text: a header row, one row per entry, and a
 * totals row. `renderRegisterPdf` renders the same `Register` with the
 * same cell values (`formatApprovalReference`, the raw ISO date, the plain
 * decimal quantity) — see `equivalence.test.ts` for the proof the two
 * agree. */
export function renderRegisterCsv(register: Register): string {
	const header = csvRow([
		m.register_column_date(),
		m.register_column_quantity(),
		m.register_column_scope(),
		m.register_column_approval()
	]);

	const rows = register.entries.map((entry) =>
		csvRow([
			entry.date,
			String(entry.quantity),
			entry.scope,
			formatApprovalReference(entry.approval)
		])
	);

	const totalsRow = csvRow(['', String(register.totalQuantity), m.register_totals_label(), '']);

	return [header, ...rows, totalsRow].map((row) => `${row}\r\n`).join('');
}
