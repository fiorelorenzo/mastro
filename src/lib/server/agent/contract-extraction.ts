// #86: everything about reading a contract out of a PDF that does not need
// a model. The model's only job is to find the terms and the ambiguous
// clauses and say what they read as; deciding whether the answer is
// well-shaped, and whether a claimed clause is actually in the document,
// is this file's, and it is pure so it can be tested exhaustively without
// a network call — the same split `day-extraction.ts` (#85) makes.
//
// The central case (issue #86's own example): a renewal clause that reads
// two ways is not decided here, or by the model. It becomes a
// `clauseFlags` entry carrying both readings and the verbatim text they
// come from; `contract.renewalType` (or whichever field is affected)
// comes back `null`, and stays null — the database's own NOT NULL column
// refuses the proposal until a human's edit picks a reading
// (`repositories/proposal.ts`'s `proposalValidationIssue`, the 'contract'
// case).
//
// `proposedFields` is untrusted model output, so it is parsed once, at
// this boundary, with a schema — the same convention
// `import/formats/fattura-pa/xml.ts` already established for untrusted
// external input — rather than a hand-rolled chain of `typeof` guards.

import { z } from 'zod';
import { checkVerbatim, normaliseForComparison } from './verbatim';
import { contractRenewalType, invoicingCadence } from '$lib/server/db/schema/contract';
import { disbursementPeriod, rateCardKind, rateUnit } from '$lib/server/db/schema/rate-card';
import { minorUnits } from '$lib/money';

const trimmedNonBlank = z.string().trim().min(1);
const nullableTrimmed = z
	.string()
	.trim()
	.min(1)
	.nullable()
	.optional()
	.transform((value) => value ?? null);

const PaymentTermsSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('net'), days: z.number() }),
		z.object({ kind: z.literal('day_of_month'), day: z.number() })
	])
	.nullable()
	.optional()
	.transform((value) =>
		value === null || value === undefined
			? null
			: value.kind === 'net'
				? value
				: { kind: 'day_of_month' as const, day: value.day, monthOffset: 1 as const }
	);

const ExpensePolicySchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('not_reimbursed') }),
		z.object({ kind: z.literal('reimbursed_at_cost') }),
		z.object({ kind: z.literal('reimbursed_with_cap'), capAmount: z.number() })
	])
	.nullable()
	.optional()
	.transform((value) =>
		value === null || value === undefined
			? null
			: value.kind === 'reimbursed_with_cap'
				? { kind: 'reimbursed_with_cap' as const, capAmount: minorUnits(value.capAmount) }
				: value
	);

/** The counterparty a first-intake contract PDF names — not yet a `client`
 * row, since #86's whole point is that one may not exist yet. Whether it
 * becomes a new row or gets linked to one already on file is a reviewer's
 * explicit choice on the proposal review screen, recorded as a
 * `ClientChoice` (`repositories/proposal.ts`) — never decided here.
 *
 * Only `legalName` and `country` are required, because those are the only
 * two columns `client` still demands (migration 0056). Everything else is
 * nullable here for the same reason it is nullable there: a contract that
 * does not state a tax id or a street address is an ordinary contract, not
 * a malformed one, and a foreign counterparty frequently states neither.
 * Requiring them cost a real extraction: a UK company's agreement was read
 * correctly, reported `taxId: null` exactly as the prompt's "never invent"
 * rule asks, and was then thrown away by this schema with the reviewer
 * told nothing at all. */
const ExtractedClientSchema = z.object({
	legalName: trimmedNonBlank,
	taxId: nullableTrimmed,
	vatId: nullableTrimmed,
	country: trimmedNonBlank,
	addressLine1: nullableTrimmed,
	addressLine2: nullableTrimmed,
	addressCity: nullableTrimmed,
	addressPostalCode: nullableTrimmed,
	addressRegion: nullableTrimmed
});
export type ExtractedClient = z.infer<typeof ExtractedClientSchema>;

/** `contract`'s own columns, exactly as the model reported them — a field
 * the model flagged as ambiguous (`clauseFlags`) reports `null` here
 * rather than picking a reading, for every column that is genuinely
 * capable of being ambiguous in a real contract (`renewalType`,
 * `renewalNoticeDays`, `endsOn`, `paymentTerms`, `expensePolicy`,
 * `signedDocumentReference`). Columns this codebase has never seen a
 * contract leave ambiguous (`title`, `startsOn`, `terminationNoticeDays`,
 * `currency`, `taxTreatment`, `invoicingCadence`, the two boolean gates)
 * are required — a model that cannot read even these has not understood
 * the document, and `parseExtractedContract` throws rather than writing a
 * proposal missing its own name. */
const ExtractedContractFieldsSchema = z.object({
	title: trimmedNonBlank,
	signedDocumentReference: nullableTrimmed,
	startsOn: trimmedNonBlank,
	endsOn: nullableTrimmed,
	renewalType: z
		.enum(contractRenewalType.enumValues)
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	renewalNoticeDays: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	terminationNoticeDays: z.number(),
	paymentTerms: PaymentTermsSchema,
	invoicingCadence: z.enum(invoicingCadence.enumValues),
	currency: trimmedNonBlank,
	taxTreatment: nullableTrimmed,
	requiresPriorApproval: z.boolean(),
	requiresExpensePreAuthorisation: z.boolean(),
	/**
	 * Whether the contract charges the pack's social charge (#379). Optional
	 * in the schema and **false when absent**, which is the whole point: a
	 * document that says nothing about a surcharge has not agreed to one,
	 * and defaulting the other way would invoice a client 4% nobody wrote
	 * down. Extraction may set it only when the document says so.
	 */
	appliesSocialCharge: z
		.boolean()
		.optional()
		.transform((value) => value ?? false),
	expensePolicy: ExpensePolicySchema
});
export type ExtractedContractFields = z.infer<typeof ExtractedContractFieldsSchema>;

const ExtractedRateCardSchema = z.object({
	validFrom: trimmedNonBlank,
	validTo: nullableTrimmed,
	kind: z.enum(rateCardKind.enumValues),
	amount: z.number(),
	unit: z.enum(rateUnit.enumValues),
	allowedFractions: z.array(z.number()),
	minimumHours: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	disbursementPeriod: z
		.enum(disbursementPeriod.enumValues)
		.nullable()
		.optional()
		.transform((value) => value ?? null)
});
export type ExtractedRateCard = z.infer<typeof ExtractedRateCardSchema>;

/** A clause that reads more than one way (#20's shape, reused here): the
 * verbatim span it rests on, at least two candidate readings, and which
 * proposed field it affects — `null` on that field is how a reviewer
 * finds their way from "this proposal cannot be accepted yet" back to the
 * clause that explains why. `field` is a dotted path into
 * `ExtractedContractCandidate` (`"contract.renewalType"`,
 * `"contract.paymentTerms"`, `"rateCards.0.disbursementPeriod"`) — free
 * text rather than a closed union, since which fields a real contract
 * leaves ambiguous is exactly what this feature exists to discover, not
 * a fixed list to maintain.
 *
 * `interpretationAdopted` is never set by the model — it starts `null` on
 * every flag a producer writes, and stays that way until a human's own
 * edit on the review screen names which reading actually governs.
 * `proposalValidationIssue`'s 'contract' case (`repositories/proposal.ts`)
 * refuses to accept a proposal carrying even one flag still `null` here —
 * the database-shaped mechanism behind "an ambiguous clause blocks silent
 * acceptance and requires an explicit choice." Once accepted, this is
 * what `applyProposal` copies onto `clause_note.interpretationAdopted`,
 * next to `verbatimText`, the record issue #86 asks for. */
const ExtractedClauseFlagSchema = z.object({
	// Deliberately lenient where `validateClauseFlags` is strict. A real
	// run against Claude produced a correct extraction alongside one junk
	// flag (null reference, blank text, one reading), and a strict schema
	// here threw the whole payload away — the worst kind of failure,
	// because it reads as the model getting the contract wrong when it had
	// got every field right. Rejecting a bad flag *with its reason*, and
	// keeping the rest, is what `validateClauseFlags` is for; a field left
	// null by a dropped flag is still refused at accept time by
	// `proposalValidationIssue`, so nothing unexplained can be accepted.
	field: z.string().trim(),
	clauseReference: z.string().trim().nullable().catch(null),
	verbatimText: z.string().trim().catch(''),
	readings: z.array(z.string().trim()).catch([]),
	interpretationAdopted: nullableTrimmed
});
export type ExtractedClauseFlag = z.infer<typeof ExtractedClauseFlagSchema>;

const ExtractedContractCandidateSchema = z.object({
	client: ExtractedClientSchema,
	contract: ExtractedContractFieldsSchema,
	rateCards: z.array(ExtractedRateCardSchema).min(1, 'at least one rate card is required'),
	clauseFlags: z.array(ExtractedClauseFlagSchema)
});
export type ExtractedContractCandidate = z.infer<typeof ExtractedContractCandidateSchema>;

/** What `validateClauseFlags` guarantees, said in the type: an accepted
 * flag always cites a clause, because a flag that cites none is rejected.
 * `applyProposal` copies `clauseReference` onto a NOT NULL column, so this
 * is the difference between a cast at the call site and a fact. */
export type AcceptedClauseFlag = ExtractedClauseFlag & { readonly clauseReference: string };

export interface RejectedClauseFlag {
	readonly flag: ExtractedClauseFlag;
	readonly reason: string;
}

export interface ValidatedClauseFlags {
	readonly accepted: readonly AcceptedClauseFlag[];
	readonly rejected: readonly RejectedClauseFlag[];
}

/** The shortest clause text that can still be read as evidence — longer
 * than `day-extraction.ts`'s `MINIMUM_EXCERPT_LENGTH` (12) because a
 * contract clause worth flagging as ambiguous is a sentence, never a
 * fragment; a model asked to quote a clause and handing back three words
 * has not actually quoted the clause. */
export const MINIMUM_CLAUSE_LENGTH = 20;

/** The ceiling a contract's confidence is capped at once it carries at
 * least one clause flag — always below the review screen's 0.5 "needs
 * review" threshold (`proposal-status.ts`'s own boundary, restated from
 * `day-extraction.ts`'s `CONFIDENCE_NEEDS_REVIEW_THRESHOLD`), mirroring
 * that file's `YEAR_ROLLOVER_CONFIDENCE_CAP`: a contract with an
 * unresolved ambiguity can never read as settled merely because the model
 * itself was confident about everything else. */
export const CLAUSE_FLAG_CONFIDENCE_CAP = 0.4;

/**
 * The instructions the model is given. The one rule issue #86 is written
 * around, stated as plainly as `day-extraction.ts`'s own prompt states the
 * year-rollover rule: an ambiguous clause is flagged, never decided.
 */
export function contractExtractionInstructions(): string {
	return [
		'You read one contract PDF (already extracted to plain text) and propose its founding terms for a consultant who bills a client by the day, hour or a fixed recurring fee.',
		'',
		'Answer with JSON and nothing else, in exactly this shape:',
		// `country` is a two-letter placeholder rather than a real code: a
		// concrete one would both bias the reading toward one jurisdiction and
		// be a country literal outside a pack (AGENTS.md invariant 1).
		'{"proposedFields":{' +
			'"client":{"legalName":"...","taxId":null,"vatId":null,"country":"..","addressLine1":null,"addressLine2":null,"addressCity":null,"addressPostalCode":null,"addressRegion":null},' +
			'"contract":{"title":"...","signedDocumentReference":null,"startsOn":"YYYY-MM-DD","endsOn":null,"renewalType":"none","renewalNoticeDays":null,"terminationNoticeDays":30,"paymentTerms":{"kind":"net","days":30},"invoicingCadence":"monthly","currency":"EUR","taxTreatment":"...","requiresPriorApproval":false,"requiresExpensePreAuthorisation":false,"expensePolicy":{"kind":"not_reimbursed"}},' +
			'"rateCards":[{"validFrom":"YYYY-MM-DD","validTo":null,"kind":"daily","amount":650,"unit":"day","allowedFractions":[1,0.5],"minimumHours":null,"disbursementPeriod":null}],' +
			'"clauseFlags":[{"field":"contract.renewalType","clauseReference":"Art. 4","verbatimText":"...","readings":["reading one","reading two"]}]' +
			'},"excerpt":"...","confidence":0.0,"confidenceReason":"..."}',
		'',
		'Rules:',
		'- The client needs only a legal name and a country. Its tax id, VAT id and every line of its address are reported only when the document states them, and are null otherwise \u2014 a foreign counterparty often gives none of them, and that is an ordinary contract, not an incomplete one. Never derive one from the letterhead, the domain or the currency.',
		'- renewalType is one of: none, explicit, counterparty_option, tacit.',
		'- paymentTerms is either {"kind":"net","days":N} or {"kind":"day_of_month","day":N}. If the document\u2019s own wording does not map cleanly onto either shape, leave paymentTerms null and flag it \u2014 never force an approximate fit.',
		'- invoicingCadence is one of: monthly, quarterly, annual, on_completion.',
		'- expensePolicy is one of {"kind":"not_reimbursed"}, {"kind":"reimbursed_at_cost"}, {"kind":"reimbursed_with_cap","capAmount":N} where capAmount is in cents.',
		'- rateCards is an array because a contract can have more than one rate over time (an addendum changing the fee is a second, adjacent card, never an overwrite of the first \u2014 validTo of the earlier card is the day before validFrom of the next). kind is one of: fixed_recurring, daily, hourly, one_off; unit is one of: hour, day, month, year, lump_sum; amount is the plain decimal rate, never in cents.',
		'- THE CENTRAL RULE: an ambiguous clause \u2014 one that reads more than one defensible way, or that contradicts another clause in the same document \u2014 is never decided. Leave the field it affects null (or, for a rate card, use your best reading and still flag it) and add one entry to clauseFlags naming the field, the clause reference, the verbatim text the ambiguity rests on (copy it exactly, do not paraphrase), and at least two distinct readings in your own words. A clause you are confident about is not flagged.',
		'- excerpt quotes the contract\u2019s own identification: the parties and the date. Those two are usually far apart \u2014 the parties open the document, the date sits in the signature block at the end \u2014 so quote both and write "[...]" between them. Copy each side exactly, do not paraphrase, and never bridge a gap with your own words.',
		'- The same applies to a clauseFlags verbatimText resting on two clauses that disagree: quote both, separated by "[...]". Every side of a quotation is checked against the document, so a side that is paraphrased, reflowed or stitched together from scattered words is rejected \u2014 and a quotation that elides needs each side to stand on its own, not a stray fragment.',
		'- confidence is your own, between 0 and 1. Lower it whenever a field you did report is a plausible inference rather than something the document states outright (an inferred VAT rate, a rate card default applied in the absence of any text on point).',
		'- confidenceReason is a short, specific reason for a lowered confidence. Omit it, or leave it empty, when confidence is high.',
		'- Never invent a client, a date or a rate the document does not state.'
	].join('\n');
}

/**
 * Reads the model's `proposedFields` into an `ExtractedContractCandidate`,
 * or throws naming what was wrong. Never repairs — the same discipline
 * `day-extraction.ts`'s `parseExtractedDays` follows: a model that
 * answered the wrong shape has not understood the task, and guessing on
 * its behalf is how a wrong contract reaches a human looking plausible.
 * Individual business fields (`renewalType`, `paymentTerms`,
 * `expensePolicy`) are allowed through as `null` — that is the shape a
 * genuinely ambiguous clause takes, checked by `proposalValidationIssue`
 * against the database's own NOT NULL columns at accept time, not here.
 */
export function parseExtractedContract(
	proposedFields: Record<string, unknown>
): ExtractedContractCandidate {
	const result = ExtractedContractCandidateSchema.safeParse(proposedFields);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
			.join('; ');
		throw new Error(`model response's proposedFields do not match the contract shape: ${issues}`);
	}
	return result.data;
}

/**
 * Splits the model's clause flags into the ones a human can be shown —
 * genuinely quoted from the document, long enough to read as evidence,
 * naming at least two readings (the schema above already enforces the
 * count) — and the ones that are wrong on their face, with the reason
 * kept rather than dropped (`drain.ts`'s `DrainOutcome.rejectedDays` is
 * the day-extraction precedent this mirrors). A dropped flag leaves its
 * field's `null` unexplained, which is safe, never silently corrupting:
 * `proposalValidationIssue` still refuses to accept a null NOT NULL
 * column with no flag left to justify it.
 */
export function validateClauseFlags(
	flags: readonly ExtractedClauseFlag[],
	content: string
): ValidatedClauseFlags {
	const accepted: AcceptedClauseFlag[] = [];
	const rejected: RejectedClauseFlag[] = [];

	for (const flag of flags) {
		// Checks the schema used to make impossible and now deliberately
		// lets through, so a malformed flag costs its own flag rather than
		// the whole extraction. Each one carries the reason a reviewer
		// would need.
		if (flag.field === '') {
			rejected.push({ flag, reason: 'the flag names no field' });
			continue;
		}
		const clauseReference = flag.clauseReference;
		if (clauseReference === null || clauseReference === '') {
			rejected.push({ flag, reason: 'the flag cites no clause' });
			continue;
		}
		if (flag.readings.filter((reading) => reading !== '').length < 2) {
			rejected.push({
				flag,
				reason: 'a clause flag must name at least two distinct readings'
			});
			continue;
		}
		if (normaliseForComparison(flag.verbatimText).length < MINIMUM_CLAUSE_LENGTH) {
			rejected.push({
				flag,
				reason: `verbatimText ${JSON.stringify(flag.verbatimText)} is too short to be evidence`
			});
			continue;
		}
		// An ambiguity is very often two clauses that disagree, and two
		// clauses are rarely adjacent, so the quotation may elide (#279).
		const verbatim = checkVerbatim(flag.verbatimText, content, MINIMUM_CLAUSE_LENGTH);
		if (!verbatim.ok) {
			rejected.push({ flag, reason: `verbatimText: ${verbatim.reason}` });
			continue;
		}
		accepted.push({ ...flag, clauseReference });
	}
	return { accepted, rejected };
}

/**
 * The confidence and reason a contract proposal actually carries, folding
 * the model's own answer together with the clause-flag guard — mirrors
 * `day-extraction.ts`'s `dayConfidence`: the guard can only make a
 * contract more cautious, never override it back to settled.
 */
export function contractConfidence(
	candidateConfidence: number,
	candidateReason: string | null | undefined,
	acceptedFlagCount: number
): { confidence: number; confidenceReason: string | null } {
	if (acceptedFlagCount === 0) {
		return { confidence: candidateConfidence, confidenceReason: candidateReason ?? null };
	}
	const flagReason =
		acceptedFlagCount === 1
			? '1 clause reads more than one way and needs a human choice'
			: `${acceptedFlagCount} clauses read more than one way and need a human choice`;
	return {
		confidence: Math.min(candidateConfidence, CLAUSE_FLAG_CONFIDENCE_CAP),
		confidenceReason: candidateReason ? `${candidateReason}; ${flagReason}` : flagReason
	};
}
