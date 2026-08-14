// The proposal review screen (#243, #86): the evidence — the archived
// message or PDF in full, the matched excerpt marked — is the heavier
// half, the proposed fields the lighter one. A `work_unit` proposal's
// fields are flat (`editedFieldsFromForm` below); a `contract` or
// `invoice` proposal's are not, so each gets its own reconstruction —
// `contractEditsFromForm` rebuilds the nested `client`/`contract`/
// `clauseFlags` objects `acceptProposal` expects, `invoiceFieldsFromProposal`
// only narrows for display since an invoice proposal is never edited here
// (#86's own comment: rendering, not a second producer). Pending proposals
// from the same document are siblings a reviewer steps through in order;
// accepted/rejected ones render the same layout read-only, with the day,
// contract or invoice it created linked once it exists.
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { proposalsCrumbs } from '$lib/nav/crumbs';
import { minorUnits } from '$lib/money';
import {
	parseExtractedContract,
	type ExtractedClauseFlag,
	type ExtractedClient,
	type ExtractedContractCandidate,
	type ExtractedContractFields
} from '$lib/server/agent/contract-extraction';
import type {
	InvoiceProposedFields,
	ValidatedInvoiceLine
} from '$lib/server/agent/invoice-extraction';
import type {
	ContractRenewalType,
	ExpensePolicy,
	InvoicingCadence,
	PaymentTerms
} from '$lib/server/db/schema';
import { decodeMessageBody, parseMessage } from '$lib/server/mail/headers';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { matchClientByTaxId, type ClientMatchCandidate } from '$lib/server/import/client-match';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { listClients, type ClientInput } from '$lib/server/repositories/client';
import { getContractWithClient } from '$lib/server/repositories/contract';
import {
	getDocument,
	readDocumentBytes,
	toSourceDocumentValue
} from '$lib/server/repositories/document';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import {
	acceptProposal,
	diffProposalFields,
	getProposal,
	listProposalsForDocument,
	rejectProposal,
	type ClientChoice
} from '$lib/server/repositories/proposal';
import { listRateCards } from '$lib/server/repositories/rate-card';
import type { Actions, PageServerLoad } from './$types';

/** Every proposed field, re-typed from the reviewer's own edit to the JSON
 * blob's original type — a number stays a number, a boolean stays a
 * boolean — so an untouched field round-trips unchanged and a genuinely
 * edited one reaches `acceptProposal` as the same shape the target
 * repository's own writer expects, not a string it then has to reject.
 * A field the reviewer left blank or unparsable is passed through as the
 * raw string instead of guessing: `acceptProposal`'s own dispatcher then
 * rejects it with a clear type error rather than writing a silently wrong
 * value (a blank quantity becoming `0`, or worse, `NaN` slipping past a
 * `> 0` database check that treats `NaN` as greater than everything).
 * `work_unit`'s own fields are flat, so this stays the one place a plain
 * top-level merge is correct — `contractEditsFromForm` below is why it is
 * not reused for `'contract'`. */
function editedFieldsFromForm(
	proposedFields: Record<string, unknown>,
	formData: FormData
): Record<string, unknown> {
	const edited: Record<string, unknown> = {};
	for (const [field, originalValue] of Object.entries(proposedFields)) {
		if (!formData.has(field)) continue;
		const raw = String(formData.get(field) ?? '').trim();
		if (typeof originalValue === 'number') {
			const parsed = Number(raw);
			edited[field] = raw.length > 0 && Number.isFinite(parsed) ? parsed : raw;
		} else if (typeof originalValue === 'boolean') {
			edited[field] = raw === 'true' || raw === 'on';
		} else {
			edited[field] = raw.length > 0 ? raw : null;
		}
	}
	return edited;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** `workUnitFields`'s counterpart in `../+page.server.ts` — kept file-local
 *  rather than shared, since the two loaders read it into differently
 *  shaped view models (this one keeps `notes`, the queue never shows it). */
function workUnitFields(
	fields: Record<string, unknown>
): { date: string; quantity: number; scope: string; notes: string | null } | null {
	const { date, quantity, scope, notes } = fields;
	if (typeof date !== 'string' || typeof quantity !== 'number' || typeof scope !== 'string') {
		return null;
	}
	return { date, quantity, scope, notes: typeof notes === 'string' ? notes : null };
}

/** `fields` read as an `ExtractedContractCandidate` for display — the same
 * parser `proposalValidationError`'s 'contract' case
 * (`repositories/proposal.ts`) already runs, reused rather than
 * duplicated so this screen and the accept dispatcher never disagree
 * about the shape. `null` only for a row whose `proposedFields` do not
 * even parse (a malformed producer run) — the template falls back to the
 * generic per-field list in that case rather than crashing. */
function contractCandidateFromProposal(
	fields: Record<string, unknown>
): ExtractedContractCandidate | null {
	try {
		return parseExtractedContract(fields);
	} catch {
		return null;
	}
}

/** `fields` read as `InvoiceProposedFields` for display — a narrowing
 * guard rather than a shared parser, since `invoiceInputFromFields`
 * (`repositories/proposal.ts`) is module-private and this screen never
 * edits an invoice proposal's own fields (#86's brief: render number,
 * date, client, lines and totals, nothing more). `null` for a row whose
 * `proposedFields` don't match — the template falls back to the generic
 * per-field list. */
function invoiceFieldsFromProposal(fields: Record<string, unknown>): InvoiceProposedFields | null {
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
	} = fields;
	if (
		typeof number !== 'string' ||
		typeof issueDate !== 'string' ||
		typeof clientName !== 'string'
	) {
		return null;
	}
	if (dueDate !== null && typeof dueDate !== 'string') return null;
	if (typeof currency !== 'string' || !Array.isArray(lines)) return null;
	if (
		typeof taxableAmount !== 'number' ||
		typeof taxAmount !== 'number' ||
		typeof total !== 'number'
	) {
		return null;
	}
	const validatedLines: ValidatedInvoiceLine[] = [];
	for (const raw of lines) {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
		const { description, quantity, unitPrice, amount, taxRate } = raw as Record<string, unknown>;
		if (
			typeof description !== 'string' ||
			typeof quantity !== 'number' ||
			typeof unitPrice !== 'number' ||
			typeof amount !== 'number' ||
			typeof taxRate !== 'number'
		) {
			return null;
		}
		try {
			validatedLines.push({
				description,
				quantity,
				unitPrice: minorUnits(unitPrice),
				amount: minorUnits(amount),
				taxRate
			});
		} catch {
			return null;
		}
	}
	try {
		return {
			number,
			issueDate,
			dueDate,
			clientName,
			currency,
			lines: validatedLines,
			taxableAmount: minorUnits(taxableAmount),
			taxAmount: minorUnits(taxAmount),
			total: minorUnits(total)
		};
	} catch {
		return null;
	}
}

function stringField(formData: FormData, name: string): string {
	return String(formData.get(name) ?? '').trim();
}

function optionalStringField(formData: FormData, name: string): string | null {
	const value = stringField(formData, name);
	return value.length > 0 ? value : null;
}

/** The "create a new client" fields off the review screen's own
 * submission, falling back to `candidate`'s extracted value for any field
 * the form did not carry — shared by `contractEditsFromForm`'s own
 * `edits.client` and `clientChoiceFromForm`'s `'new'` branch, so the two
 * never drift into reading the form differently. */
function extractedClientFromForm(candidate: ExtractedClient, formData: FormData): ExtractedClient {
	return {
		legalName: stringField(formData, 'client.legalName') || candidate.legalName,
		taxId: stringField(formData, 'client.taxId') || candidate.taxId,
		vatId: optionalStringField(formData, 'client.vatId'),
		country: (stringField(formData, 'client.country') || candidate.country).toUpperCase(),
		addressLine1: stringField(formData, 'client.addressLine1') || candidate.addressLine1,
		addressLine2: optionalStringField(formData, 'client.addressLine2'),
		addressCity: stringField(formData, 'client.addressCity') || candidate.addressCity,
		addressPostalCode:
			stringField(formData, 'client.addressPostalCode') || candidate.addressPostalCode,
		addressRegion: optionalStringField(formData, 'client.addressRegion')
	};
}

/**
 * The `ClientChoice` `acceptProposal` requires for a `'contract'` accept
 * (design: "the client behind an extracted contract is always an explicit
 * choice") — read straight off the client section's own submission,
 * never guessed. `'existing'.updates` carries only the fields the
 * reviewer ticked to adopt from the document (`clientFieldAdopt.<field>`,
 * one checkbox per field the template offers a diff for): an unticked
 * box stays unticked, so a changed registered address never reaches the
 * client row merely because a PDF asserted it. `noticeChannel`/`sdiCode`/
 * `pecAddress` are never among them — no contract PDF states any of
 * them, so there is never a document value to offer adopting.
 */
function clientChoiceFromForm(
	candidate: ExtractedContractCandidate,
	formData: FormData
): ClientChoice {
	if (stringField(formData, 'clientMode') === 'existing') {
		const c = candidate.client;
		const updates: Partial<ClientInput> = {};
		if (formData.has('clientFieldAdopt.legalName')) updates.legalName = c.legalName;
		if (formData.has('clientFieldAdopt.taxId')) updates.taxId = c.taxId;
		if (formData.has('clientFieldAdopt.vatId')) updates.vatId = c.vatId;
		if (formData.has('clientFieldAdopt.country')) updates.country = c.country.toUpperCase();
		if (formData.has('clientFieldAdopt.addressLine1')) updates.addressLine1 = c.addressLine1;
		if (formData.has('clientFieldAdopt.addressLine2')) updates.addressLine2 = c.addressLine2;
		if (formData.has('clientFieldAdopt.addressCity')) updates.addressCity = c.addressCity;
		if (formData.has('clientFieldAdopt.addressPostalCode')) {
			updates.addressPostalCode = c.addressPostalCode;
		}
		if (formData.has('clientFieldAdopt.addressRegion')) updates.addressRegion = c.addressRegion;
		return { kind: 'existing', clientId: stringField(formData, 'clientId'), updates };
	}
	return {
		kind: 'new',
		fields: {
			...extractedClientFromForm(candidate.client, formData),
			// A contract's own letterhead never carries a notice channel or
			// an SdI routing code — the same reason `applyProposal`'s
			// create-client write leaves both null.
			noticeChannel: null,
			sdiCode: null,
			pecAddress: null,
			contacts: []
		}
	};
}

/**
 * Rebuilds `client`, `contract` and `clauseFlags` from the review screen's
 * own submission — the `'contract'` counterpart of `editedFieldsFromForm`
 * above. Those three are nested objects, not flat top-level keys, so
 * `acceptProposal`'s shallow `{...proposedFields, ...edits}` merge needs
 * each one rebuilt whole rather than patched key by key; `candidate`
 * supplies the fallback for any field the form did not carry (a
 * conditionally-hidden one, e.g. `renewalNoticeDays` when `renewalType` is
 * `'none'`, correctly comes back `null` rather than falling back — see the
 * template's own conditional rendering). Every reading choice
 * (`clauseFlags.{index}.interpretationAdopted`) is required by the
 * template before Accept renders enabled, but a value is still read
 * defensively here, since the true gate is `proposalValidationError`
 * inside `acceptProposal`, not this screen's JavaScript.
 */
function contractEditsFromForm(
	candidate: ExtractedContractCandidate,
	formData: FormData
): {
	client: ExtractedClient;
	contract: ExtractedContractFields;
	clauseFlags: ExtractedClauseFlag[];
} {
	const client = extractedClientFromForm(candidate.client, formData);

	const currency = (stringField(formData, 'currency') || candidate.contract.currency).toUpperCase();

	const paymentTermsKind = stringField(formData, 'paymentTermsKind');
	const paymentTerms: PaymentTerms | null =
		paymentTermsKind === 'net'
			? { kind: 'net', days: Number(stringField(formData, 'paymentTermsNetDays')) }
			: paymentTermsKind === 'day_of_month'
				? {
						kind: 'day_of_month',
						day: Number(stringField(formData, 'paymentTermsDayOfMonthDay')),
						monthOffset: 1
					}
				: null;

	const expensePolicyKind = stringField(formData, 'expensePolicyKind');
	const expensePolicy: ExpensePolicy | null =
		expensePolicyKind === 'not_reimbursed'
			? { kind: 'not_reimbursed' }
			: expensePolicyKind === 'reimbursed_at_cost'
				? { kind: 'reimbursed_at_cost' }
				: expensePolicyKind === 'reimbursed_with_cap'
					? {
							kind: 'reimbursed_with_cap',
							capAmount: decimalStringToMinorUnits(
								stringField(formData, 'expensePolicyCapAmount'),
								currency,
								getLocale()
							)
						}
					: null;

	const renewalNoticeDaysRaw = stringField(formData, 'renewalNoticeDays');
	const terminationNoticeDaysRaw = stringField(formData, 'terminationNoticeDays');

	const contract: ExtractedContractFields = {
		title: stringField(formData, 'title') || candidate.contract.title,
		signedDocumentReference: optionalStringField(formData, 'signedDocumentReference'),
		startsOn: stringField(formData, 'startsOn') || candidate.contract.startsOn,
		endsOn: optionalStringField(formData, 'endsOn'),
		renewalType: (stringField(formData, 'renewalType') || null) as ContractRenewalType | null,
		renewalNoticeDays: renewalNoticeDaysRaw.length > 0 ? Number(renewalNoticeDaysRaw) : null,
		terminationNoticeDays: Number(
			terminationNoticeDaysRaw.length > 0
				? terminationNoticeDaysRaw
				: candidate.contract.terminationNoticeDays
		),
		paymentTerms,
		invoicingCadence: (stringField(formData, 'invoicingCadence') ||
			candidate.contract.invoicingCadence) as InvoicingCadence,
		currency,
		taxTreatment: optionalStringField(formData, 'taxTreatment'),
		requiresPriorApproval: formData.has('requiresPriorApproval'),
		requiresExpensePreAuthorisation: formData.has('requiresExpensePreAuthorisation'),
		expensePolicy
	};

	const clauseFlags: ExtractedClauseFlag[] = candidate.clauseFlags.map((flag, index) => ({
		...flag,
		interpretationAdopted:
			optionalStringField(formData, `clauseFlags.${index}.interpretationAdopted`) ??
			flag.interpretationAdopted
	}));

	return { client, contract, clauseFlags };
}

export const load: PageServerLoad = async ({ params }) => {
	const row = await getProposal(params.id);
	if (!row) error(404, m.proposal_detail_not_found());

	const [contract, document, thread, siblingRows] = await Promise.all([
		row.contractId ? getContractWithClient(row.contractId) : null,
		getDocument(row.documentId),
		getInboundThreadForDocument(row.documentId),
		listProposalsForDocument(row.documentId)
	]);

	// A 'contract' or 'invoice' proposal's evidence is a PDF, not an RFC
	// 822 message (#86/#87) — `parseMessage` is only meaningful for the
	// mail provenance `work_unit` proposals actually carry.
	const isMailDocument = document?.mime === 'message/rfc822';
	const bytes = isMailDocument && document ? await readDocumentBytes(document) : null;
	const parsedMessage = bytes ? parseMessage(bytes) : null;
	const messageBody = parsedMessage ? decodeMessageBody(parsedMessage) : '';

	const effectiveFields = workUnitFields(row.acceptedFields ?? row.proposedFields);
	const amount =
		effectiveFields && row.contractId
			? priceWorkUnitOnDate(effectiveFields, await listRateCards(row.contractId))
			: null;

	// The fields a 'contract' or 'invoice' proposal actually shows: the
	// proposed shape while pending (so an in-progress edit reflects what
	// was read from the PDF), the accepted shape once decided (so a
	// resolved clause flag's own chosen reading shows here exactly as it
	// was recorded on the clause note) — `acceptedFields ?? proposedFields`
	// is the same fallback the generic decided-fields view already uses.
	const decidedFields = row.acceptedFields ?? row.proposedFields;
	const effectiveTargetFields = row.status === 'pending' ? row.proposedFields : decidedFields;
	const contractCandidate =
		row.targetType === 'contract' ? contractCandidateFromProposal(effectiveTargetFields) : null;
	const invoiceFields =
		row.targetType === 'invoice' ? invoiceFieldsFromProposal(effectiveTargetFields) : null;

	// The client picker's own candidates and the tax-id preselection —
	// only meaningful while there is still a choice to make: a decided
	// proposal's client section renders read-only (the extracted/accepted
	// fields, same as before this change), so it needs neither. The list
	// is trimmed to the fields a document's client can be compared
	// against — `client_form_*`'s own labels, not the row's timestamps or
	// contacts. `matchClientByTaxId` (`import/client-match.ts`) is the
	// invoice-import lane's own matcher, reused rather than a second
	// implementation of "does this tax id already belong to a client" —
	// its null-safety included: an absent tax id, on either side, never
	// matches, so a client with none is never wrongly preselected.
	const existingClients =
		row.status === 'pending' && row.targetType === 'contract' && contractCandidate
			? (await listClients()).map((c) => ({
					id: c.id,
					legalName: c.legalName,
					taxId: c.taxId,
					vatId: c.vatId,
					country: c.country,
					addressLine1: c.addressLine1,
					addressLine2: c.addressLine2,
					addressCity: c.addressCity,
					addressPostalCode: c.addressPostalCode,
					addressRegion: c.addressRegion
				}))
			: [];
	const clientMatchCandidates: ClientMatchCandidate[] = existingClients.map((c) => ({
		id: c.id,
		taxId: c.taxId,
		legalName: c.legalName,
		activeContractId: null
	}));
	const clientMatchId = contractCandidate
		? (matchClientByTaxId({ taxId: contractCandidate.client.taxId }, clientMatchCandidates)?.id ??
			null)
		: null;

	// An accepted 'contract' proposal creates a client and a contract, but
	// `proposal.contractId` stays null forever for a first-intake row
	// (`db/schema/proposal.ts`'s own doc comment) — `resultId` is the new
	// contract's id, and the client detail route needs its client's id
	// too, so the accepted contract is looked up once here rather than
	// the template guessing at a URL it cannot otherwise build.
	const acceptedContract =
		row.targetType === 'contract' && row.status === 'accepted' && row.resultId
			? await getContractWithClient(row.resultId)
			: null;

	// Siblings from the same document, in the order a reviewer would step
	// through them — the day each proposes, not creation order, since a
	// producer's own fan-out order ("Thursday and Friday" -> two rows) has
	// no particular reason to already be chronological. Only 'work_unit'
	// proposals ever share a document with siblings (#86/#87 each write
	// exactly one proposal per document), so this stays keyed on the same
	// `workUnitFields` shape the queue itself sorts by.
	const siblings = [...siblingRows].sort((a, b) => {
		const dateA = workUnitFields(a.proposedFields)?.date ?? '';
		const dateB = workUnitFields(b.proposedFields)?.date ?? '';
		return dateA.localeCompare(dateB);
	});
	const siblingIndex = siblings.findIndex((sibling) => sibling.id === row.id);
	const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
	const nextSibling =
		siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;

	const crumbs = proposalsCrumbs();

	return {
		proposal: {
			id: row.id,
			targetType: row.targetType,
			excerpt: row.excerpt,
			confidence: row.confidence,
			confidenceReason: row.confidenceReason,
			validationError: row.validationError,
			status: row.status,
			proposedFields: row.proposedFields,
			acceptedFields: row.acceptedFields,
			resultId: row.resultId,
			decidedBy: row.decidedBy,
			decidedAt: row.decidedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
			changes: diffProposalFields(row)
		},
		contract: contract
			? { id: contract.id, title: contract.title, clientLegalName: contract.client.legalName }
			: null,
		currency: contract?.currency ?? 'EUR',
		amount,
		contractCandidate,
		existingClients,
		clientMatchId,
		invoiceFields,
		acceptedContractClientId: acceptedContract?.client.id ?? null,
		sourceDocument: document ? toSourceDocumentValue(document) : null,
		message: {
			from: parsedMessage?.headers.get('from') ?? null,
			to: parsedMessage?.headers.get('to') ?? null,
			subject: thread?.subject ?? null,
			receivedAt: thread?.receivedAt.toISOString() ?? null,
			body: messageBody
		},
		siblings: {
			position: siblingIndex >= 0 ? siblingIndex + 1 : 1,
			count: siblings.length,
			previous: previousSibling
				? {
						id: previousSibling.id,
						date: workUnitFields(previousSibling.proposedFields)?.date ?? null
					}
				: null,
			next: nextSibling
				? { id: nextSibling.id, date: workUnitFields(nextSibling.proposedFields)?.date ?? null }
				: null
		},
		crumbs
	};
};

export const actions: Actions = {
	accept: async ({ request, params, locals }) => {
		const row = await getProposal(params.id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { decisionError: m.proposal_detail_already_decided() });
		}

		const formData = await request.formData();
		let edits: Record<string, unknown>;
		let clientChoice: ClientChoice | undefined;
		if (row.targetType === 'contract') {
			const candidate = contractCandidateFromProposal(row.proposedFields);
			if (!candidate) {
				return fail(400, {
					decisionError: 'proposed fields no longer match the contract shape'
				});
			}
			try {
				edits = contractEditsFromForm(candidate, formData);
			} catch (err) {
				return fail(400, { decisionError: errorMessage(err) });
			}
			clientChoice = clientChoiceFromForm(candidate, formData);
			if (clientChoice.kind === 'existing' && clientChoice.clientId === '') {
				return fail(400, { decisionError: m.proposal_contract_client_choice_required_error() });
			}
		} else if (row.targetType === 'invoice') {
			// Never edited on this screen (#86's brief: render number, date,
			// client, lines and totals) — accepted exactly as proposed.
			edits = {};
		} else {
			edits = editedFieldsFromForm(row.proposedFields, formData);
		}

		try {
			await acceptProposal(params.id, { edits, decidedBy: locals.user!.email, clientChoice });
		} catch (err) {
			return fail(400, { decisionError: errorMessage(err) });
		}
		return { decided: true, action: 'accept' as const };
	},

	reject: async ({ params, locals }) => {
		const row = await getProposal(params.id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { decisionError: m.proposal_detail_already_decided() });
		}

		await rejectProposal(params.id, locals.user!.email);
		return { decided: true, action: 'reject' as const };
	}
};
