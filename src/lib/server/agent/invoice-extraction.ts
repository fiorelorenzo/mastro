// #87: everything about reading an invoice out of a PDF that does not need
// a model to check. The model's only job is to read the printed figures;
// deciding whether the answer is usable — the arithmetic, the dates, the
// excerpt — is this file's, and it is pure so it can be tested without a
// network call. Mirrors day-extraction.ts's split for the same reason: a
// model will confidently report a total that does not equal its own
// lines, or quote an excerpt it paraphrased rather than copied.
//
// One call, at most one proposal: unlike a day-approval message, which
// can name several days, one invoice PDF is one invoice. There is no
// per-line excerpt the way a day gets its own — the top-level `excerpt`
// every `ExtractionResult` already carries (`runner/types.ts`) is this
// proposal's only one, checked here the same way each day's own is
// checked in `day-extraction.ts`.

import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { sumMinorUnits, type MinorUnits } from '$lib/money';

/** One line as the model reports it — every amount a plain decimal
 * string, the same locale-free wire shape a structured document already
 * uses (`$lib/server/import/decimal.ts`), so the one parser reads both. */
export interface ExtractedInvoiceLine {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: string;
	readonly amount: string;
	readonly taxRate: number;
}

/** An invoice as the model reports it, before anything has been checked. */
export interface ExtractedInvoice {
	readonly number: string;
	readonly issueDate: string;
	/** `null` when the document states no due date — never computed by the
	 * model; `resolveDueDate` (`domain/invoice.ts`) is what fills a gap,
	 * the same way it does for a structured import, and it runs at accept
	 * time (`applyProposal`), not here. */
	readonly dueDate: string | null;
	/** The customer's own name, for the reviewer to cross-check against
	 * the contract this proposal is already scoped to — never written to
	 * any column of its own: `invoice.contractId` is the client link,
	 * exactly the way a structured import's own row carries no client
	 * name either (`db/schema/invoice.ts`'s own doc comment). */
	readonly clientName: string;
	readonly currency: string;
	readonly lines: readonly ExtractedInvoiceLine[];
	readonly taxableAmount: string;
	readonly taxAmount: string;
	readonly total: string;
}

/** Mirrors `day-extraction.ts`'s own constant of the same name: below
 * this, a verbatim excerpt still reads as nothing next to a proposed
 * invoice — a reviewer learns nothing checking "INV" against the figures
 * beside it. */
const MINIMUM_EXCERPT_LENGTH = 12;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One line, validated and converted: every amount now `MinorUnits`,
 * never a string a formatter could mistake for major units. */
export interface ValidatedInvoiceLine {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: MinorUnits;
	readonly amount: MinorUnits;
	readonly taxRate: number;
}

/** The shape `createProposal`'s `proposedFields` actually carries for an
 * `'invoice'` proposal, and what `applyProposal`'s own case
 * (`repositories/proposal.ts`) reads back at accept time. Plain numbers
 * for money, not strings: the same choice `work_unit`'s own
 * `proposedFields.quantity` already makes, so the review screen's amount
 * inputs work the same way for both target types. */
export interface InvoiceProposedFields {
	readonly number: string;
	readonly issueDate: string;
	readonly dueDate: string | null;
	readonly clientName: string;
	readonly currency: string;
	readonly lines: readonly ValidatedInvoiceLine[];
	readonly taxableAmount: MinorUnits;
	readonly taxAmount: MinorUnits;
	readonly total: MinorUnits;
}

export type InvoiceValidationResult =
	| { readonly ok: true; readonly fields: InvoiceProposedFields }
	| { readonly ok: false; readonly reason: string };

/**
 * The instructions the model is given. Absolute figures only, in the
 * wire decimal shape `decimalStringToMinorUnits` already parses for a
 * structured document — asking the model to answer in the same shape a
 * real e-invoice uses means one parser serves both, and a locale never
 * enters the picture (this is not anyone's typed input, it is a document
 * being read).
 */
export function invoiceExtractionInstructions(): string {
	return [
		'You read the extracted text of one invoice PDF and report its fields, for a consultant recording it in a ledger.',
		'',
		'Answer with JSON and nothing else, in exactly this shape:',
		'{"proposedFields":{"number":"...","issueDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD or null","clientName":"...","currency":"EUR","lines":[{"description":"...","quantity":1,"unitPrice":"600.00","amount":"600.00","taxRate":0}],"taxableAmount":"600.00","taxAmount":"0.00","total":"600.00"},"excerpt":"...","confidence":0.0,"confidenceReason":"..."}',
		'',
		'Rules:',
		'- number is the invoice\u2019s own progressive number, exactly as printed.',
		'- issueDate is the invoice\u2019s own issue date. dueDate is the stated payment due date, or null when the document does not state one \u2014 never computed.',
		'- clientName is the customer\u2019s legal name as printed, never the issuer\u2019s.',
		'- Every amount (unitPrice, amount, taxableAmount, taxAmount, total) is a plain decimal string with a literal dot and no thousands separator or currency symbol, e.g. "600.00", however the document itself formats it.',
		'- taxableAmount is the sum of every line\u2019s amount. total is taxableAmount plus taxAmount. Get the arithmetic right against the document\u2019s own printed figures.',
		'- taxRate is a percentage number (0, 22, ...), not a fraction.',
		'- excerpt is the shortest verbatim span of the document text that shows the invoice number and issue date together. Copy it exactly, character for character \u2014 do not paraphrase or reformat it.',
		'- confidence is your own, between 0 and 1. Lower it \u2014 well below 0.5 \u2014 whenever the text is garbled, a figure is unreadable, the document does not look like an invoice at all, or you had to guess at a figure the text does not actually show.',
		'- confidenceReason is a short, specific reason for a lowered confidence \u2014 what exactly made you unsure. Omit it, or leave it empty, when confidence is high.'
	].join('\n');
}

/**
 * Reads the model's `proposedFields` into an `ExtractedInvoice`, or
 * throws naming what was wrong. Never repairs: a model that answered the
 * wrong shape has not understood the task, and guessing on its behalf is
 * how a wrong figure reaches a human looking plausible. Mirrors
 * `day-extraction.ts`'s `parseExtractedDays`.
 */
export function parseExtractedInvoice(proposedFields: Record<string, unknown>): ExtractedInvoice {
	const {
		number,
		issueDate,
		dueDate,
		clientName,
		currency,
		lines,
		taxableAmount,
		taxAmount,
		total
	} = proposedFields;

	if (typeof number !== 'string' || number.trim() === '') {
		throw new Error("model response's proposedFields.number is not a non-blank string");
	}
	if (typeof issueDate !== 'string' || !ISO_DATE.test(issueDate)) {
		throw new Error("model response's proposedFields.issueDate is not a YYYY-MM-DD string");
	}
	if (dueDate !== null && dueDate !== undefined && typeof dueDate !== 'string') {
		throw new Error("model response's proposedFields.dueDate is not a string or null");
	}
	if (dueDate !== null && dueDate !== undefined && !ISO_DATE.test(dueDate)) {
		throw new Error("model response's proposedFields.dueDate is not a YYYY-MM-DD string");
	}
	if (typeof clientName !== 'string' || clientName.trim() === '') {
		throw new Error("model response's proposedFields.clientName is not a non-blank string");
	}
	if (typeof currency !== 'string' || currency.trim() === '') {
		throw new Error("model response's proposedFields.currency is not a non-blank string");
	}
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new Error("model response's proposedFields.lines is not a non-empty array");
	}
	if (typeof taxableAmount !== 'string') {
		throw new Error("model response's proposedFields.taxableAmount is not a string");
	}
	if (typeof taxAmount !== 'string') {
		throw new Error("model response's proposedFields.taxAmount is not a string");
	}
	if (typeof total !== 'string') {
		throw new Error("model response's proposedFields.total is not a string");
	}

	const parsedLines = lines.map((raw, index) => {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			throw new Error(`line ${index} is not an object`);
		}
		const { description, quantity, unitPrice, amount, taxRate } = raw as Record<string, unknown>;
		if (typeof description !== 'string' || description.trim() === '') {
			throw new Error(`line ${index} has no description`);
		}
		if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
			throw new Error(`line ${index} has no numeric quantity`);
		}
		if (typeof unitPrice !== 'string') throw new Error(`line ${index} has no unitPrice string`);
		if (typeof amount !== 'string') throw new Error(`line ${index} has no amount string`);
		if (typeof taxRate !== 'number' || !Number.isFinite(taxRate)) {
			throw new Error(`line ${index} has no numeric taxRate`);
		}
		return { description: description.trim(), quantity, unitPrice, amount, taxRate };
	});

	return {
		number: number.trim(),
		issueDate,
		dueDate: typeof dueDate === 'string' ? dueDate : null,
		clientName: clientName.trim(),
		currency: currency.trim(),
		lines: parsedLines,
		taxableAmount,
		taxAmount,
		total
	};
}

/** Verbatim, the same way each day's own excerpt is checked
 * (`day-extraction.ts`'s `rejectionReason`): whitespace is the one
 * difference worth forgiving, because a model reflowing a wrapped PDF
 * line is still quoting. `null` when the excerpt passes. */
export function invoiceExcerptRejectionReason(excerpt: string, content: string): string | null {
	const normalisedExcerpt = excerpt.replace(/\s+/g, ' ').trim();
	if (normalisedExcerpt.length < MINIMUM_EXCERPT_LENGTH) {
		return `excerpt ${JSON.stringify(excerpt)} is too short to be evidence`;
	}
	if (!content.replace(/\s+/g, ' ').trim().includes(normalisedExcerpt)) {
		return `excerpt ${JSON.stringify(excerpt)} is not verbatim in the document`;
	}
	return null;
}

/**
 * Checks `invoice` on its own face — dates, positive figures, tax-rate
 * range — and converts every amount to `MinorUnits` through the one door
 * that type has (`$lib/money`'s `minorUnits`, reached here via
 * `decimalStringToMinorUnits`), then checks the arithmetic the database
 * itself would enforce at accept time
 * (`0015_invoice_constraints.sql`'s `invoice_check_totals`): the lines
 * sum to `taxableAmount`, and `taxableAmount + taxAmount` equals `total`.
 * Finding either mismatch here, rather than only at `INSERT`, is the same
 * restraint `proposalValidationIssue` already applies to `work_unit` —
 * #245's own lesson, that a proposal a human can never actually accept is
 * worse than one refused up front.
 *
 * Returns a reason rather than throwing: a model that read a real invoice
 * but got a figure wrong has not misunderstood the task the way a
 * malformed JSON shape does (`parseExtractedInvoice`'s job to catch) — it
 * is exactly the "one bad job" `drain.ts` already expects to report
 * instead of silently losing.
 */
export function validateInvoice(invoice: ExtractedInvoice): InvoiceValidationResult {
	const issueParsed = new Date(`${invoice.issueDate}T00:00:00Z`);
	if (
		Number.isNaN(issueParsed.getTime()) ||
		issueParsed.toISOString().slice(0, 10) !== invoice.issueDate
	) {
		return { ok: false, reason: `issueDate ${invoice.issueDate} is not a real date` };
	}
	if (invoice.dueDate !== null) {
		const dueParsed = new Date(`${invoice.dueDate}T00:00:00Z`);
		if (
			Number.isNaN(dueParsed.getTime()) ||
			dueParsed.toISOString().slice(0, 10) !== invoice.dueDate
		) {
			return { ok: false, reason: `dueDate ${invoice.dueDate} is not a real date` };
		}
	}

	try {
		const lines: ValidatedInvoiceLine[] = invoice.lines.map((line, index) => {
			if (line.quantity <= 0) {
				throw new Error(`line ${index} quantity ${line.quantity} is not positive`);
			}
			if (line.taxRate < 0 || line.taxRate > 100) {
				throw new Error(`line ${index} taxRate ${line.taxRate} is out of range 0..100`);
			}
			const unitPrice = decimalStringToMinorUnits(line.unitPrice, invoice.currency);
			const amount = decimalStringToMinorUnits(line.amount, invoice.currency);
			if (unitPrice < 0) throw new Error(`line ${index} unitPrice ${line.unitPrice} is negative`);
			if (amount < 0) throw new Error(`line ${index} amount ${line.amount} is negative`);
			return {
				description: line.description,
				quantity: line.quantity,
				unitPrice,
				amount,
				taxRate: line.taxRate
			};
		});

		const taxableAmount = decimalStringToMinorUnits(invoice.taxableAmount, invoice.currency);
		const taxAmount = decimalStringToMinorUnits(invoice.taxAmount, invoice.currency);
		const total = decimalStringToMinorUnits(invoice.total, invoice.currency);
		if (taxableAmount < 0) throw new Error(`taxableAmount ${invoice.taxableAmount} is negative`);
		if (taxAmount < 0) throw new Error(`taxAmount ${invoice.taxAmount} is negative`);
		if (total < 0) throw new Error(`total ${invoice.total} is negative`);

		const computedTaxable = sumMinorUnits(lines.map((line) => line.amount));
		if (computedTaxable !== taxableAmount) {
			return {
				ok: false,
				reason: `taxableAmount ${taxableAmount} does not match the sum of its lines (${computedTaxable})`
			};
		}
		if (taxableAmount + taxAmount !== total) {
			return {
				ok: false,
				reason: `total ${total} does not equal taxableAmount (${taxableAmount}) + taxAmount (${taxAmount})`
			};
		}

		return {
			ok: true,
			fields: {
				number: invoice.number,
				issueDate: invoice.issueDate,
				dueDate: invoice.dueDate,
				clientName: invoice.clientName,
				currency: invoice.currency,
				lines,
				taxableAmount,
				taxAmount,
				total
			}
		};
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
