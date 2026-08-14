import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { invoicesCrumbs } from '$lib/nav/crumbs';
import { db } from '$lib/server/db';
import {
	computeInvoiceBalance,
	daysLate,
	isOverdue,
	resolveInvoiceRouting
} from '$lib/server/domain/invoice';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { generateAndStoreInvoiceDocument } from '$lib/server/fiscal/generate-invoice-document';
import { minorUnitsFromMajor } from '$lib/money';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import {
	getInvoiceDocuments,
	getInvoiceWithLines,
	listPaymentsForInvoice,
	recordPayment
} from '$lib/server/repositories/invoice';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { getPracticeProfile } from '$lib/server/repositories/practice-profile';
import { listSentEmailsForInvoice } from '$lib/server/repositories/sent-email';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const invoiceRow = await getInvoiceWithLines(params.id);
	if (!invoiceRow) error(404, m.invoice_not_found());
	const [documents, rateCards, chaseHistory, resolvedPack, payments] = await Promise.all([
		getInvoiceDocuments(invoiceRow.id),
		listRateCards(invoiceRow.contractId),
		listSentEmailsForInvoice(invoiceRow.id),
		// The pack in force on the invoice's own issue date, never "today":
		// which regime applied — and therefore whether SdI routing (#259)
		// is even a thing to say — is a fact about the invoice, not about
		// whoever happens to be reading it later.
		resolveActiveFiscalPack(db, invoiceRow.issueDate),
		// Every payment on record (#212) — the payment history table and
		// the balance below both read this one query, never a second.
		listPaymentsForInvoice(invoiceRow.id)
	]);

	// #212: derived from `invoice.total` and every payment on record —
	// never a stored flag. Every other figure on this page that used to
	// read `invoice.paidOn` reads this instead.
	const balance = computeInvoiceBalance(invoiceRow.total, payments);

	// `formats` is a jurisdiction pack's own declaration of which national
	// invoice format(s) it uses (AGENTS.md invariant 1: never branch on a
	// country literal here) — empty for the generic pack, `['FPR12']` for
	// both Italian regimes. SdI routing only exists to say something about
	// when FatturaPA applies; showing it under the generic pack would be
	// showing a fact about a system this invoice never goes through.
	const routing =
		(resolvedPack?.pack.formats.length ?? 0) > 0
			? resolveInvoiceRouting(invoiceRow.contract.client)
			: null;

	// Each day's own contribution (#239: "the days behind each line are
	// visible", with a figure that reads as a verifiable sum, never an
	// assertion) — priced through the exact function that priced it in the
	// first place (`work-unit-pricing.ts`, the same one `/invoices/new`'s
	// live preview uses), against whichever rate card was in force on the
	// day's own date. Never `line.unitPrice * day.quantity`: a line's own
	// `amount` is deliberately the sum of per-day prices, not that product,
	// for exactly the rounding reason `priceRateCard`'s own doc comment
	// gives — this recomputation has to agree with it, not approximate it.
	// `null` (never guessed at) when no card in force can price the day —
	// e.g. one predating the earliest rate card on record.
	const invoice = {
		...invoiceRow,
		lines: invoiceRow.lines.map((line) => ({
			...line,
			days: line.days.map((day) => {
				const price = priceWorkUnitOnDate(
					{ date: day.date, quantity: Number(day.quantity) },
					rateCards
				);
				return {
					...day,
					amount: price === null ? null : minorUnitsFromMajor(price, invoiceRow.currency)
				};
			})
		}))
	};

	const crumbs = invoicesCrumbs();
	return {
		invoice,
		balance,
		payments,
		// The archived original(s): an import stores the structured
		// document plus any attachment alongside it (`persist.ts`), a
		// hand-entered invoice none — #215's "the archived original of an
		// imported invoice".
		documents: documents.map(toSourceDocumentValue),
		// Every email this invoice has been the subject of, most recent
		// first (#230) — the History card's own chase list, so "when was
		// this last chased and with which template" reads straight off its
		// top row rather than a second, separate figure.
		chaseHistory: chaseHistory.map((row) => ({
			...row,
			sentAt: row.sentAt.toISOString()
		})),
		// Today, at UTC midnight as an ISO date — what the payment form's
		// own date field defaults to, computed once here so the form and
		// any later reasoning about it agree on the same instant.
		today: new Date().toISOString().slice(0, 10),
		// Whether "prepare a reminder" is the header rail's primary action
		// (#239) — the same derivation the ageing table uses, recomputed
		// here rather than read off a stored flag.
		overdue: isOverdue(invoiceRow.dueDate, balance.settledOn),
		// Feeds the header's status badge (the list's own `invoiceStatus`,
		// computed the same way): only meaningful when the invoice is
		// unpaid, but always recomputed against "now" rather than trusting
		// a stored flag, same reasoning as `overdue` above.
		daysLate: daysLate(invoiceRow.dueDate),
		// Which of SdI's three delivery paths this invoice would take
		// (#259), or `null` under a pack that carries no national e-invoice
		// format at all — see the `formats` comment above.
		routing,
		crumbs
	};
};

export const actions: Actions = {
	// One form, in the Payment card, always visible (#239's "buries the
	// one consequential action") — amount, date, method and reference
	// (#212): a payment is a row, not a flag, so this never marks the
	// invoice "paid" directly. Whether it is now fully settled is derived
	// on the next read, through `computeInvoiceBalance`, not written here.
	pay: async ({ request, params }) => {
		const invoiceRow = await getInvoiceWithLines(params.id);
		if (!invoiceRow) error(404, m.invoice_not_found());

		const formData = await request.formData();
		const amountRaw = String(formData.get('amount') ?? '').trim();
		const date = String(formData.get('date') ?? '').trim();
		const method = String(formData.get('method') ?? '').trim();
		const reference = String(formData.get('reference') ?? '').trim();

		const amount = Number(amountRaw);
		if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
			return fail(400, { payError: m.invoice_validation_amount_invalid() });
		}
		if (!date) return fail(400, { payError: m.invoice_validation_payment_date_required() });

		await recordPayment(params.id, {
			amount: minorUnitsFromMajor(amount, invoiceRow.currency),
			date,
			method: method || null,
			reference: reference || null
		});
		redirect(303, `/invoices/${params.id}`);
	},

	// Generates this invoice's FatturaPA document under the pack in force
	// on its own issue date and archives it as a `document` (#260,
	// invariant 4: the generated XML is itself the source document once
	// it exists). The existing Documents section re-renders it on the
	// next load — no separate download route, `/documents/[id]` already
	// serves any document by id.
	generateFattura: async ({ params }) => {
		const invoiceRow = await getInvoiceWithLines(params.id);
		if (!invoiceRow) error(404, m.invoice_not_found());

		const [practiceProfile, resolvedPack] = await Promise.all([
			getPracticeProfile(),
			// The pack in force on the invoice's own issue date, same
			// reasoning as `load`'s own `resolvedPack` above — which regime
			// governs is a fact about the invoice, not about now.
			resolveActiveFiscalPack(db, invoiceRow.issueDate)
		]);
		if (!practiceProfile) {
			return fail(400, { fatturaError: m.invoice_detail_fattura_missing_practice_profile() });
		}
		if (!resolvedPack) {
			return fail(400, { fatturaError: m.invoice_detail_fattura_missing_pack() });
		}

		try {
			const outcome = await generateAndStoreInvoiceDocument(
				invoiceRow,
				practiceProfile,
				resolvedPack.pack
			);
			if (outcome.kind === 'unsupported') {
				return fail(400, { fatturaError: m.invoice_detail_fattura_unsupported() });
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			return fail(400, { fatturaError: m.invoice_detail_fattura_generation_failed({ reason }) });
		}
		redirect(303, `/invoices/${params.id}`);
	}
};
