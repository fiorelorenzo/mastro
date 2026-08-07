// The day register as PDF (#70), via pdfkit: a pure JS layout engine with
// no native dependencies and no headless browser to download at test or
// build time (the alternative most PDF-from-HTML approaches reach for).
// This keeps `pnpm test` and CI hermetic and fast — see the PR description
// for the fuller justification.
import PDFDocument from 'pdfkit';
import * as m from '$lib/paraglide/messages';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import { formatApprovalReference } from './format';
import type { Register } from './types';

const PAGE_MARGIN = 40;
const ROW_PADDING = 6;
const COLUMNS = [
	{ x: PAGE_MARGIN, width: 70 }, // date
	{ x: PAGE_MARGIN + 70, width: 60 }, // quantity
	{ x: PAGE_MARGIN + 130, width: 220 }, // scope
	{ x: PAGE_MARGIN + 350, width: 165 } // approval
] as const;
const TABLE_RIGHT_EDGE = PAGE_MARGIN + 350 + 165;

function drawRow(doc: PDFKit.PDFDocument, y: number, cells: readonly string[], bold: boolean) {
	doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
	const rowHeight =
		Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: COLUMNS[i].width }))) +
		ROW_PADDING;
	cells.forEach((cell, i) => doc.text(cell, COLUMNS[i].x, y, { width: COLUMNS[i].width }));
	return y + rowHeight;
}

/** Renders `register` as a PDF buffer in `language` — the contract's own
 * template language (#69), never the operator's active interface locale —
 * a header row, one row per entry, and a totals row: the same cell values
 * `renderRegisterCsv` writes, so the two agree (`equivalence.test.ts`). A
 * new page starts whenever the next row would overflow the current one,
 * so the register is never silently truncated regardless of how many days
 * a period holds. */
export function renderRegisterPdf(
	register: Register,
	language: ContractTemplateLanguage
): Promise<Buffer> {
	const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
	const chunks: Buffer[] = [];
	doc.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	doc
		.font('Helvetica-Bold')
		.fontSize(14)
		.text(
			m.register_title({ from: register.from, to: register.to }, { locale: language }),
			PAGE_MARGIN,
			PAGE_MARGIN
		);
	doc.moveDown();

	let y = doc.y;
	y = drawRow(
		doc,
		y,
		[
			m.register_column_date({}, { locale: language }),
			m.register_column_quantity({}, { locale: language }),
			m.register_column_scope({}, { locale: language }),
			m.register_column_approval({}, { locale: language })
		],
		true
	);
	doc.moveTo(PAGE_MARGIN, y).lineTo(TABLE_RIGHT_EDGE, y).strokeColor('#000000').stroke();
	y += ROW_PADDING;

	const pageBottom = doc.page.height - PAGE_MARGIN;
	for (const entry of register.entries) {
		if (y > pageBottom - 40) {
			doc.addPage();
			y = PAGE_MARGIN;
		}
		y = drawRow(
			doc,
			y,
			[entry.date, String(entry.quantity), entry.scope, formatApprovalReference(entry.approval)],
			false
		);
	}

	if (y > pageBottom - 40) {
		doc.addPage();
		y = PAGE_MARGIN;
	}
	doc.moveTo(PAGE_MARGIN, y).lineTo(TABLE_RIGHT_EDGE, y).strokeColor('#000000').stroke();
	y += ROW_PADDING;
	drawRow(
		doc,
		y,
		['', String(register.totalQuantity), m.register_totals_label({}, { locale: language }), ''],
		true
	);

	doc.end();
	return done;
}
