// #83: the only place a `proposal` row is written or decided. Producing
// one (#85, #86, #87 — none of which exist yet) is `createProposal` and
// nothing more: a producer supplies `documentId`, `contractId`,
// `targetType`, `proposedFields` shaped for that target type (see
// `applyProposal` below for what each currently-supported type expects),
// `excerpt` and `confidence`. Everything after that — editing, accepting,
// rejecting — is a human decision made on the review screen
// (`routes/proposals`), never the producer's.
//
// Accepting is the "no bypass" half of invariant 3: it does not insert a
// row directly, it calls the same repository functions (`createWorkUnit`,
// `transitionWorkUnit`, `createApprovalForDocument`) a human's own form
// submissions call, inside one transaction with the proposal's own status
// update. A rejected write there — a database constraint a manual entry
// would also trip — rolls the whole thing back, proposal included, so a
// proposal can never end up marked `accepted` next to a row that was
// never actually written. `proposal.test.ts` proves this both ways: a
// valid proposal produces exactly what a human's own entry would, and an
// invalid one produces nothing at all, in either case.
//
// A `work_unit` proposal specifically writes the day already `approved`
// (#209), never merely `proposed`: the proposal exists only because a
// human wrote something approving it, which is precisely the evidence
// the `approved` state requires. `applyProposal` below creates or reuses
// the `approval` row that evidence rests on before recording the day —
// "reuses" because several proposals can share one source document (one
// email approving several days), and #209's contract is one `approval`
// per document, not one per accepted day.

import { desc, eq } from 'drizzle-orm';
import { minorUnits } from '$lib/money';
import { db, type DbExecutor } from '$lib/server/db';
import {
	document,
	proposal,
	type ProposalStatus,
	type ProposalTargetType
} from '$lib/server/db/schema';
import { parseMessage } from '$lib/server/mail/headers';
import {
	parseExtractedContract,
	type ExtractedContractCandidate
} from '../agent/contract-extraction';
import { createApprovalForDocument } from './approval';
import { createClauseNote } from './clause-note';
import { createClient, getClientWithContacts, updateClient, type ClientInput } from './client';
import { createContract } from './contract';
import { claimDocumentForContract, getDocument, readDocumentBytes } from './document';
import { getInboundThreadForDocument } from './inbound-thread';
import { createInvoice, type InvoiceInput, type InvoiceLineInput } from './invoice';
import { createRateCard } from './rate-card';
import { createApprovedWorkUnit, getWorkUnit, type WorkUnitInput } from './work-unit';

export type ProposalRow = typeof proposal.$inferSelect;

export type ProposalInput = {
	documentId: string;
	// Null only for a first-intake 'contract' proposal (#86) — see
	// `db/schema/proposal.ts`'s own doc comment on this column.
	contractId: string | null;
	targetType: ProposalTargetType;
	proposedFields: Record<string, unknown>;
	excerpt: string;
	confidence: number;
	/** The producer's own reason for a lowered confidence (#244) — see
	 * `proposal.confidenceReason`'s own doc comment. */
	confidenceReason?: string | null;
};

/**
 * Writes a proposal, first checking `input.proposedFields` against the
 * same constraints the target table would enforce on an INSERT (#245) and
 * recording what it finds on `validationError` rather than discovering it
 * later at `acceptProposal` time, after a human has already decided. See
 * `proposalValidationError` below for what "the same constraints" means.
 */
export async function createProposal(input: ProposalInput, executor: DbExecutor = db) {
	const validationError = proposalValidationError(
		input.targetType,
		input.contractId,
		input.proposedFields
	);
	const [row] = await executor
		.insert(proposal)
		.values({ ...input, validationError })
		.returning();
	return row;
}

export async function getProposal(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(proposal).where(eq(proposal.id, id));
	return row;
}

/** Every proposal already produced from one document. The drain's
 * idempotency check (#85): a job whose document already has proposals has
 * been applied, whatever the queue file says, so a crash between writing
 * the rows and moving the file cannot double a reviewer's work. */
export async function listProposalsForDocument(documentId: string, executor: DbExecutor = db) {
	return executor.select().from(proposal).where(eq(proposal.documentId, documentId));
}

/** Every proposal, most recent first, optionally narrowed to one status —
 * the review queue's feed (pending) and its decided history (accepted or
 * rejected) are the same query with a different filter. */
export async function listProposals(status: ProposalStatus | undefined, executor: DbExecutor = db) {
	return status
		? executor
				.select()
				.from(proposal)
				.where(eq(proposal.status, status))
				.orderBy(desc(proposal.createdAt))
		: executor.select().from(proposal).orderBy(desc(proposal.createdAt));
}

/**
 * Maps a `'work_unit'` proposal's fields onto `WorkUnitInput`, the same
 * type `work-unit-form.ts` builds from a human's own day-entry submission.
 * A producer targeting `'work_unit'` supplies `proposedFields` as
 * `{ date: string, quantity: number, scope: string, notes?: string }` —
 * `contractId` is never duplicated inside the JSON blob, it is read off
 * `proposal.contractId` itself. This only shapes the day's own fields;
 * `applyProposal` is what decides the state it lands in and the approval
 * it is linked to (#209).
 */
function workUnitInputFromFields(
	row: { contractId: string },
	fields: Record<string, unknown>
): WorkUnitInput {
	const { date, quantity, scope, notes } = fields;
	if (typeof date !== 'string') throw new Error("proposal field 'date' must be a string");
	if (typeof quantity !== 'number') throw new Error("proposal field 'quantity' must be a number");
	if (typeof scope !== 'string') throw new Error("proposal field 'scope' must be a string");
	if (notes !== undefined && notes !== null && typeof notes !== 'string') {
		throw new Error("proposal field 'notes' must be a string when present");
	}
	return { contractId: row.contractId, date, quantity, scope, notes: notes ?? null };
}

/**
 * Maps an `'invoice'` proposal's fields onto `InvoiceInput` (minus
 * `contractId`, which `applyProposal` already has off `row`) — the same
 * role `workUnitInputFromFields` plays for `'work_unit'`. A producer
 * targeting `'invoice'` (#87) supplies `proposedFields` shaped exactly
 * like `InvoiceProposedFields` in `agent/invoice-extraction.ts`: `number`,
 * `issueDate`, `dueDate` (string or null), `clientName` (display only —
 * the client is reached through `contractId`, never a column of its own,
 * the same choice `invoice.contractId`'s own doc comment explains),
 * `currency`, `lines`, and the document's own declared `taxableAmount`/
 * `taxAmount`/`total`.
 *
 * `taxableAmount`/`taxAmount`/`total` are read only far enough to
 * type-check — never passed to `createInvoice`, which has no such
 * parameters and computes all three itself from `lines` (#26's own
 * invariant: an invoice's stored totals are always derived, never typed
 * twice, `persist.ts`'s `mapInvoiceToInput` makes the identical choice
 * for a structured import). They exist in `proposedFields` purely for
 * the review screen and the supersession diff to show, and staying
 * unread here is what keeps them from ever silently overriding what
 * `lines` alone determines.
 */
function invoiceInputFromFields(fields: Record<string, unknown>): Omit<InvoiceInput, 'contractId'> {
	const { number, issueDate, dueDate, currency, lines } = fields;
	if (typeof number !== 'string' || number.trim() === '') {
		throw new Error("proposal field 'number' must be a non-blank string");
	}
	if (typeof issueDate !== 'string') {
		throw new Error("proposal field 'issueDate' must be a string");
	}
	if (dueDate !== null && typeof dueDate !== 'string') {
		throw new Error("proposal field 'dueDate' must be a string or null");
	}
	if (typeof currency !== 'string' || currency.trim() === '') {
		throw new Error("proposal field 'currency' must be a non-blank string");
	}
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new Error("proposal field 'lines' must be a non-empty array");
	}

	const invoiceLines: InvoiceLineInput[] = lines.map((raw, index) => {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			throw new Error(`line ${index} must be an object`);
		}
		const { description, quantity, unitPrice, amount, taxRate } = raw as Record<string, unknown>;
		if (typeof description !== 'string' || description.trim() === '') {
			throw new Error(`line ${index} field 'description' must be a non-blank string`);
		}
		if (typeof quantity !== 'number') {
			throw new Error(`line ${index} field 'quantity' must be a number`);
		}
		if (typeof unitPrice !== 'number') {
			throw new Error(`line ${index} field 'unitPrice' must be a number`);
		}
		if (typeof amount !== 'number') {
			throw new Error(`line ${index} field 'amount' must be a number`);
		}
		if (typeof taxRate !== 'number') {
			throw new Error(`line ${index} field 'taxRate' must be a number`);
		}
		return {
			description: description.trim(),
			quantity,
			unitPrice: minorUnits(unitPrice),
			amount: minorUnits(amount),
			taxRate,
			taxTreatmentCode: null,
			workUnitIds: []
		};
	});

	return {
		number: number.trim(),
		issueDate,
		documentType: 'invoice',
		currency: currency.trim(),
		taxTreatmentCode: null,
		statutoryReference: null,
		stampDuty: null,
		socialCharge: null,
		dueDate: typeof dueDate === 'string' ? dueDate : null,
		paymentMethod: null,
		iban: null,
		transmissionId: null,
		lines: invoiceLines
	};
}

/**
 * Checks `fields` against the same constraints the target table would
 * actually enforce on an INSERT — evaluated here, at creation, rather
 * than discovered by a failed `applyProposal` after a human has already
 * clicked Accept (#245: the contract-PDF spike's `paymentTerms: {day: 0}`
 * is exactly this failure, on a target type this table does not support
 * yet). Returns what's wrong, naming the field, or null when every field
 * `applyProposal`'s own switch would read is one the table would accept.
 *
 * Deliberately narrower than a full schema: it checks only what the
 * database itself checks — types, `NOT NULL`, and the `CHECK` constraints
 * `applyProposal` would actually hit — not the business rules a
 * producer's own validation (`day-extraction.ts`'s `validateDays`, for
 * `work_unit`) already enforces before a proposal is ever created. The
 * same exhaustive `switch` as `applyProposal`, for the same reason: a new
 * target type without a case here fails to compile.
 */
function proposalValidationError(
	targetType: ProposalTargetType,
	contractId: string | null,
	fields: Record<string, unknown>
): string | null {
	switch (targetType) {
		case 'work_unit': {
			// The CHECK constraint `proposal_contract_id_required_unless_
			// first_intake_contract` guarantees this at the database level
			// for every row already written; this is that same guarantee
			// re-checked here so a producer bug cannot reach
			// `workUnitInputFromFields` with nothing to scope the day by.
			if (contractId === null) return 'a work_unit proposal requires a contract';
			let input: WorkUnitInput;
			try {
				input = workUnitInputFromFields({ contractId }, fields);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			// work_unit_quantity_positive
			if (input.quantity <= 0) {
				return `quantity ${input.quantity} must be greater than 0`;
			}
			// numeric(6, 2): four digits before the point, two after.
			if (!Number.isFinite(input.quantity) || Math.abs(input.quantity) >= 10_000) {
				return `quantity ${input.quantity} does not fit the work_unit table's numeric(6,2) column`;
			}
			// A date `parseExtractedDays`'s regex would accept but is not a
			// real calendar day, e.g. 2026-02-31.
			const parsed = new Date(`${input.date}T00:00:00Z`);
			if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date) {
				return `date ${input.date} is not a real date`;
			}
			return null;
		}
		case 'invoice': {
			if (contractId === null) return 'an invoice proposal requires a contract';
			let input: Omit<InvoiceInput, 'contractId'>;
			try {
				input = invoiceInputFromFields(fields);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			const issueParsed = new Date(`${input.issueDate}T00:00:00Z`);
			if (
				Number.isNaN(issueParsed.getTime()) ||
				issueParsed.toISOString().slice(0, 10) !== input.issueDate
			) {
				return `issueDate ${input.issueDate} is not a real date`;
			}
			if (input.dueDate !== null) {
				const dueParsed = new Date(`${input.dueDate}T00:00:00Z`);
				if (
					Number.isNaN(dueParsed.getTime()) ||
					dueParsed.toISOString().slice(0, 10) !== input.dueDate
				) {
					return `dueDate ${input.dueDate} is not a real date`;
				}
			}
			for (const [index, line] of input.lines.entries()) {
				// invoice_line_quantity_positive
				if (line.quantity <= 0) {
					return `line ${index} quantity ${line.quantity} must be greater than 0`;
				}
				// numeric(6, 2): four digits before the point, two after.
				if (!Number.isFinite(line.quantity) || Math.abs(line.quantity) >= 10_000) {
					return `line ${index} quantity ${line.quantity} does not fit the invoice_line table's numeric(6,2) column`;
				}
				// invoice_line_unit_price_non_negative
				if (line.unitPrice < 0) {
					return `line ${index} unitPrice ${line.unitPrice} must not be negative`;
				}
				// invoice_line_amount_non_negative
				if (line.amount < 0) {
					return `line ${index} amount ${line.amount} must not be negative`;
				}
				// invoice_line_tax_rate_range
				if (line.taxRate < 0 || line.taxRate > 100) {
					return `line ${index} taxRate ${line.taxRate} must be between 0 and 100`;
				}
			}
			return null;
		}
		case 'contract': {
			let candidate: ExtractedContractCandidate;
			try {
				candidate = parseExtractedContract(fields);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			// client_country_is_alpha2
			if (!/^[A-Z]{2}$/.test(candidate.client.country)) {
				return `client.country ${candidate.client.country} must be exactly two uppercase letters`;
			}
			const c = candidate.contract;
			// Every ambiguity-capable NOT NULL column: this is the actual
			// mechanism behind "an ambiguous clause blocks silent
			// acceptance" — a field a producer left null because a clause
			// read two ways stays null, and stays refused, until a
			// reviewer's own edit resolves it.
			if (c.renewalType === null) {
				return 'contract.renewalType is required before this proposal can be accepted';
			}
			if (c.paymentTerms === null) {
				return 'contract.paymentTerms is required before this proposal can be accepted';
			}
			if (c.expensePolicy === null) {
				return 'contract.expensePolicy is required before this proposal can be accepted';
			}
			// Same rule, and the reason the parser is allowed to accept a
			// null: a contract PDF often states no tax treatment at all, so
			// the extraction must survive that, and the refusal belongs here
			// where a human can supply it.
			if (c.taxTreatment === null) {
				return 'contract.taxTreatment is required before this proposal can be accepted';
			}
			// contract_renewal_notice_days_required
			if (c.renewalType === 'none' && c.renewalNoticeDays !== null) {
				return "contract.renewalNoticeDays must be null when renewalType is 'none'";
			}
			if (c.renewalType !== 'none' && (c.renewalNoticeDays === null || c.renewalNoticeDays < 0)) {
				return `contract.renewalNoticeDays is required and must be >= 0 when renewalType is '${c.renewalType}'`;
			}
			// contract_termination_notice_days_non_negative
			if (c.terminationNoticeDays < 0) {
				return `contract.terminationNoticeDays ${c.terminationNoticeDays} must not be negative`;
			}
			const startsOnParsed = new Date(`${c.startsOn}T00:00:00Z`);
			if (
				Number.isNaN(startsOnParsed.getTime()) ||
				startsOnParsed.toISOString().slice(0, 10) !== c.startsOn
			) {
				return `contract.startsOn ${c.startsOn} is not a real date`;
			}
			if (c.endsOn !== null) {
				const endsOnParsed = new Date(`${c.endsOn}T00:00:00Z`);
				if (
					Number.isNaN(endsOnParsed.getTime()) ||
					endsOnParsed.toISOString().slice(0, 10) !== c.endsOn
				) {
					return `contract.endsOn ${c.endsOn} is not a real date`;
				}
				// contract_ends_on_after_starts_on
				if (c.endsOn < c.startsOn) {
					return `contract.endsOn ${c.endsOn} is before contract.startsOn ${c.startsOn}`;
				}
			}
			// contract_currency_is_alpha3
			if (!/^[A-Z]{3}$/.test(c.currency)) {
				return `contract.currency ${c.currency} must be exactly three uppercase letters`;
			}

			for (const [index, card] of candidate.rateCards.entries()) {
				// rate_card_amount_positive
				if (card.amount <= 0) {
					return `rateCards[${index}].amount ${card.amount} must be greater than 0`;
				}
				// rate_card_allowed_fractions_present
				if (card.allowedFractions.length === 0) {
					return `rateCards[${index}].allowedFractions must not be empty`;
				}
				// rate_card_minimum_hours_only_for_hourly
				if (card.kind !== 'hourly' && card.minimumHours !== null) {
					return `rateCards[${index}].minimumHours is only allowed for kind 'hourly'`;
				}
				// rate_card_disbursement_period_matches_kind
				if (card.kind === 'fixed_recurring' && card.disbursementPeriod === null) {
					return `rateCards[${index}].disbursementPeriod is required for kind 'fixed_recurring'`;
				}
				if (card.kind !== 'fixed_recurring' && card.disbursementPeriod !== null) {
					return `rateCards[${index}].disbursementPeriod is only allowed for kind 'fixed_recurring'`;
				}
				// rate_card_valid_to_after_valid_from
				if (card.validTo !== null && card.validTo < card.validFrom) {
					return `rateCards[${index}].validTo is before its own validFrom`;
				}
			}
			// rate_card_no_overlapping_validity, checked among the proposed
			// cards themselves — the database's own exclusion constraint
			// would catch a real overlap too, but only after the first
			// insert already succeeded.
			const sortedCards = candidate.rateCards
				.map((card, index) => ({ card, index }))
				.sort((a, b) => a.card.validFrom.localeCompare(b.card.validFrom));
			for (let i = 1; i < sortedCards.length; i++) {
				const previous = sortedCards[i - 1];
				const current = sortedCards[i];
				if (previous.card.validTo === null || previous.card.validTo >= current.card.validFrom) {
					return (
						`rateCards[${previous.index}] and rateCards[${current.index}] have ` +
						'overlapping validity periods'
					);
				}
			}

			for (const [index, flag] of candidate.clauseFlags.entries()) {
				if (flag.interpretationAdopted === null) {
					return (
						`clauseFlags[${index}] (${flag.clauseReference}, affecting ${flag.field}) needs ` +
						'an interpretation chosen before this proposal can be accepted'
					);
				}
			}
			return null;
		}
	}
}

/**
 * The `From:` header off a raw RFC 822 message — `applyProposal`'s only
 * source for `approval.sender` when a `work_unit` proposal is accepted
 * (#209): the archived message is the evidence, so the sender is read
 * off it directly rather than trusted from a second, separately
 * maintained copy (nothing upstream of this table records the envelope
 * sender today). Headers only, unfolded per RFC 5322 §2.2.3 (a
 * continuation line starts with whitespace); the body past the first
 * blank line is never scanned. Prefers the address inside `<...>` over
 * the header's raw value, since `"Name" <addr>` is the common shape and
 * the address is what actually identifies who wrote it.
 */
function extractSender(raw: Buffer): string {
	const value = parseMessage(raw).headers.get('from');
	if (!value) {
		throw new Error('source message has no From header to record as the approval sender');
	}
	const sender = (value.match(/<([^>]+)>/)?.[1] ?? value).trim();
	if (!sender) {
		throw new Error('source message has a blank From header');
	}
	return sender;
}

/**
 * The `approval` a `work_unit` proposal's accept writes the day against
 * (#209) — created from the proposal's own source document, or reused
 * when an earlier proposal from that same document already created one.
 * "Reused" is deliberate, not incidental: one email can produce several
 * day proposals ("ok for Thursday and Friday"), each its own `proposal`
 * row a human accepts separately, but they are one act of approval, so
 * they share one `approval` row, never one each. The search is sibling
 * proposals for the same `documentId` that are already `accepted` with a
 * `resultId` — the day that write produced — rather than anything keyed
 * on document content, since `documentId` is exactly what ties every
 * proposal from one message together (`listProposalsForDocument`).
 *
 * Building a fresh approval reads the source message's own `From` header
 * for `sender` and its `inbound_thread` row for `receivedAt`/`messageId`
 * — both facts of the envelope, never the model's. `channel` is inferred
 * from the document's own provenance: every proposal today is produced
 * from a `'mail'` document (`agent/day-producer.ts`), so this only ever
 * resolves to `'email'` in practice; `'other'` is a defensive fallback a
 * future non-mail producer would hit, not a case this table exercises yet.
 */
async function approvalForDocument(
	row: ProposalRow & { contractId: string },
	executor: DbExecutor
): Promise<string> {
	for (const sibling of await listProposalsForDocument(row.documentId, executor)) {
		if (sibling.status !== 'accepted' || !sibling.resultId) continue;
		const siblingWorkUnit = await getWorkUnit(sibling.resultId, executor);
		if (siblingWorkUnit?.approvalId) return siblingWorkUnit.approvalId;
	}

	const thread = await getInboundThreadForDocument(row.documentId, executor);
	if (!thread) {
		throw new Error(`document ${row.documentId} has no inbound thread to record an approval from`);
	}
	const sourceDocument = await getDocument(row.documentId, executor);
	if (!sourceDocument) throw new Error(`document ${row.documentId} not found`);
	const bytes = await readDocumentBytes(sourceDocument);

	const created = await createApprovalForDocument(
		{
			contractId: row.contractId,
			channel: sourceDocument.provenance === 'mail' ? 'email' : 'other',
			sender: extractSender(bytes),
			receivedAt: thread.receivedAt,
			messageId: thread.messageId,
			excerpt: row.excerpt,
			origin: { kind: 'agent', proposalReference: row.id },
			documentId: row.documentId
		},
		executor
	);
	return created.id;
}

/**
 * What the reviewer decided the client behind a first-intake contract is
 * (design: "where a client comes from when a document names one") — data
 * `applyProposal`'s `'contract'` case performs rather than guesses. The
 * screen always sends one of these two shapes; there is no third "do
 * nothing" option, because invariant 3 requires an explicit human choice,
 * not a default.
 *
 * `'existing'.updates` carries only the fields the reviewer actually
 * ticked to adopt from the document — unchecked by default, so a changed
 * registered address never reaches the client row merely because a PDF
 * asserted it (the risk this whole section exists to close).
 */
export type ClientChoice =
	| { kind: 'existing'; clientId: string; updates: Partial<ClientInput> }
	| { kind: 'new'; fields: ClientInput };

/** Performs a `ClientChoice`: links (and optionally patches) the client
 * the reviewer picked, or creates the one they typed — the only two ways
 * `applyProposal`'s `'contract'` case is allowed to decide whose contract
 * this is. An empty `updates` object skips the write entirely rather than
 * issuing a no-op UPDATE, so "link an existing client and leave it
 * untouched" really does leave it untouched, `updated_at` included. */
async function resolveClientChoice(proposalId: string, choice: ClientChoice, executor: DbExecutor) {
	if (choice.kind === 'new') {
		return createClient(choice.fields, executor);
	}
	const existing = await getClientWithContacts(choice.clientId, executor);
	if (!existing) {
		throw new Error(
			`proposal ${proposalId} chose client ${choice.clientId}, which no longer exists`
		);
	}
	if (Object.keys(choice.updates).length === 0) return existing;
	const currentInput: ClientInput = {
		legalName: existing.legalName,
		taxId: existing.taxId,
		vatId: existing.vatId,
		country: existing.country,
		addressLine1: existing.addressLine1,
		addressLine2: existing.addressLine2,
		addressCity: existing.addressCity,
		addressPostalCode: existing.addressPostalCode,
		addressRegion: existing.addressRegion,
		noticeChannel: existing.noticeChannel,
		sdiCode: existing.sdiCode,
		pecAddress: existing.pecAddress,
		contacts: existing.contacts.map((contact) => ({
			name: contact.name,
			email: contact.email,
			phone: contact.phone,
			role: contact.role,
			canApprove: contact.canApprove
		}))
	};
	return updateClient(choice.clientId, { ...currentInput, ...choice.updates }, executor);
}

/**
 * Writes the row `row`'s target type produces, through that type's own
 * repository function and its own database triggers — the literal
 * mechanism behind invariant 3's "no bypass". Returns the new row's id, to
 * record on `proposal.resultId`.
 *
 * A `switch` with no `default`, not an if/else: `row.targetType` is typed
 * `ProposalTargetType`, so widening that union (#86 adding `'contract'`,
 * #87 adding `'invoice'`) without adding the matching case here fails to
 * compile, the same guarantee `no-country-logic.test.ts` gives the fiscal
 * packs a different way.
 */
async function applyProposal(
	row: ProposalRow,
	fields: Record<string, unknown>,
	executor: DbExecutor,
	clientChoice: ClientChoice | null
): Promise<string> {
	switch (row.targetType) {
		case 'work_unit': {
			// Guaranteed non-null by `proposal_contract_id_required_unless_
			// first_intake_contract` — re-bound to a local so the narrowing
			// carries into the object literals below, which TypeScript does
			// not infer through a property read on `row` alone.
			const contractId = row.contractId;
			if (contractId === null) {
				throw new Error(`proposal ${row.id} has no contract, which a work_unit target requires`);
			}
			const approvalId = await approvalForDocument({ ...row, contractId }, executor);
			const created = await createApprovedWorkUnit(
				workUnitInputFromFields({ contractId }, fields),
				approvalId,
				{ kind: 'agent', proposalReference: row.id },
				`accepted from proposal ${row.id}`,
				executor
			);
			return created.id;
		}
		case 'invoice': {
			const contractId = row.contractId;
			if (contractId === null) {
				throw new Error(`proposal ${row.id} has no contract, which an invoice target requires`);
			}
			const input = invoiceInputFromFields(fields);
			const created = await createInvoice(
				{ ...input, contractId },
				{ kind: 'agent', proposalReference: row.id },
				`accepted from proposal ${row.id}`,
				executor
			);
			// The PDF this proposal read becomes the invoice's own evidence
			// (invariant 4) the moment it exists to belong to — the same
			// re-owning `approvalForDocument` above does for a day's
			// approval, and the same shape `persist.ts` uses for a
			// structured import's own document. A structured document
			// arriving later for the same invoice
			// (`import/invoice-supersession.ts`) adds its own document
			// under the same owner, alongside this one; both are kept, the
			// PDF now reading as an attachment rather than the invoice's
			// only proof.
			await executor
				.update(document)
				.set({ ownerType: 'invoice', ownerId: created.id })
				.where(eq(document.id, row.documentId));
			return created.id;
		}
		case 'contract': {
			// `proposalValidationError`'s 'contract' case already refused
			// an accept while `renewalType`/`paymentTerms`/`expensePolicy`
			// or any `clauseFlags[].interpretationAdopted` was still null —
			// every `!` below is that guarantee, not a fresh assumption.
			const candidate = parseExtractedContract(fields);
			const c = candidate.contract;

			// Not a structural fact `fields` itself carries (`clauseFlags`
			// and the rest come off the document; who the client is comes
			// off the reviewer) — same reason `work_unit`/`invoice` check
			// `row.contractId` here rather than in `proposalValidationError`.
			if (clientChoice === null) {
				throw new Error(
					`proposal ${row.id} has no client choice, which a contract target requires`
				);
			}
			const clientRow = await resolveClientChoice(row.id, clientChoice, executor);

			const contractRow = await createContract(
				{
					clientId: clientRow.id,
					title: c.title,
					signedDocumentReference: c.signedDocumentReference,
					startsOn: c.startsOn,
					endsOn: c.endsOn,
					renewalType: c.renewalType!,
					renewalNoticeDays: c.renewalNoticeDays,
					terminationNoticeDays: c.terminationNoticeDays,
					paymentTerms: c.paymentTerms!,
					invoicingCadence: c.invoicingCadence,
					currency: c.currency,
					taxTreatment: c.taxTreatment!,
					requiresPriorApproval: c.requiresPriorApproval,
					templateLanguage: 'en',
					expensePolicy: c.expensePolicy!,
					requiresExpensePreAuthorisation: c.requiresExpensePreAuthorisation,
					status: 'draft'
				},
				executor
			);

			for (const card of candidate.rateCards) {
				await createRateCard({ ...card, contractId: contractRow.id }, executor);
			}

			// Every flag stored on a proposal has already been through
			// `validateClauseFlags` in the producer, which drops any that
			// cites no clause — so `clauseReference` is non-null here for the
			// same reason `renewalType` is: the validator above refused the
			// alternative.
			for (const flag of candidate.clauseFlags) {
				await createClauseNote(
					{
						contractId: contractRow.id,
						clauseReference: flag.clauseReference!,
						verbatimText: flag.verbatimText,
						interpretationAdopted: flag.interpretationAdopted!,
						notes: null
					},
					executor
				);
			}

			// The founding PDF (#86) was archived unclaimed — no contract
			// existed yet to scope it by. One does now: claim it, in the
			// same transaction as everything else this accept just wrote.
			await claimDocumentForContract(row.documentId, contractRow.id, executor);

			return contractRow.id;
		}
	}
}

export type AcceptProposalInput = {
	/** Overrides onto the proposed fields — present only for the fields the
	 * reviewer actually changed. Merged onto `proposedFields` to produce
	 * `acceptedFields`; an empty or omitted object means the proposal was
	 * accepted exactly as proposed. */
	edits?: Record<string, unknown>;
	/** The reviewer's own email — who accepted, distinct from
	 * `resultId`'s row itself recording `{kind: 'agent', proposalReference}`
	 * as the provenance of its *values*. */
	decidedBy: string;
	/** The reviewer's explicit decision about the client behind a
	 * `'contract'` proposal (design: "the client behind an extracted
	 * contract is always an explicit choice") — required for that target
	 * type, ignored for every other one. */
	clientChoice?: ClientChoice;
};

/**
 * Accepts a pending proposal: merges `edits` onto `proposedFields`, writes
 * the target row through `applyProposal`, and records the decision, all in
 * one transaction. If the target write is rejected by a database
 * constraint — the same constraint a human's own entry would trip — the
 * whole transaction rolls back and the proposal is left exactly as it was,
 * still `pending`: an accept attempt that fails produces neither a ledger
 * row nor a false `accepted` record.
 *
 * `proposedFields` merged with `edits` is checked against
 * `proposalValidationError` before `applyProposal` ever runs (#245): a
 * field the target table would reject is refused here, by name, instead
 * of surfacing as a raw constraint violation after `approvalForDocument`
 * or `createWorkUnit` already started writing. Checked against
 * `acceptedFields`, not the `validationError` stored on the row at
 * creation — an edit that fixes the offending field must be allowed
 * through.
 */
export async function acceptProposal(
	id: string,
	input: AcceptProposalInput,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}

		const acceptedFields = { ...row.proposedFields, ...(input.edits ?? {}) };
		// Re-checked against what is about to be written, not the
		// `validationError` stored at creation (#245): an edit on the review
		// screen that fixes the offending field must be allowed through, the
		// same way a proposal that was fine as proposed must stay refused if
		// an edit breaks it. Whichever it is, this runs before `applyProposal`
		// ever reaches `createWorkUnit`/`approvalForDocument`, so a rejected
		// accept here never touches either.
		const validationError = proposalValidationError(row.targetType, row.contractId, acceptedFields);
		if (validationError !== null) {
			throw new Error(`proposal ${id} cannot be accepted as proposed: ${validationError}`);
		}
		const resultId = await applyProposal(row, acceptedFields, executor, input.clientChoice ?? null);

		const [updated] = await executor
			.update(proposal)
			.set({
				status: 'accepted',
				acceptedFields,
				resultId,
				decidedBy: input.decidedBy,
				decidedAt: new Date()
			})
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

/** Rejects a pending proposal. Writes nothing to any other table — a
 * rejected proposal is only ever a decided row here, never a ledger entry
 * of any kind. */
export async function rejectProposal(
	id: string,
	decidedBy: string,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}
		const [updated] = await executor
			.update(proposal)
			.set({ status: 'rejected', decidedBy, decidedAt: new Date() })
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

export interface ProposalFieldChange {
	readonly field: string;
	readonly proposed: unknown;
	readonly accepted: unknown;
}

/**
 * Every field whose accepted value differs from what was proposed — #83's
 * acceptance criterion made concrete: "the diff between proposed and
 * accepted is the only honest measure of whether the agent is getting
 * better or worse." Computed on read from the two blobs `proposal` already
 * keeps forever, rather than stored as its own column, so it can never go
 * stale relative to them. Empty for a proposal accepted with no edits, and
 * always empty for one that is still pending or was rejected (no
 * `acceptedFields` to compare against).
 */
export function diffProposalFields(row: {
	proposedFields: Record<string, unknown>;
	acceptedFields: Record<string, unknown> | null;
}): ProposalFieldChange[] {
	if (!row.acceptedFields) return [];
	const accepted = row.acceptedFields;
	const fields = new Set([...Object.keys(row.proposedFields), ...Object.keys(accepted)]);
	const changes: ProposalFieldChange[] = [];
	for (const field of fields) {
		const proposedValue = row.proposedFields[field];
		const acceptedValue = accepted[field];
		if (JSON.stringify(proposedValue) !== JSON.stringify(acceptedValue)) {
			changes.push({ field, proposed: proposedValue, accepted: acceptedValue });
		}
	}
	return changes.sort((a, b) => a.field.localeCompare(b.field));
}
