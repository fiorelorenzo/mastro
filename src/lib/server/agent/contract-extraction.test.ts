import { expect, test } from 'vitest';
import {
	CLAUSE_FLAG_CONFIDENCE_CAP,
	contractConfidence,
	MINIMUM_CLAUSE_LENGTH,
	parseExtractedContract,
	validateClauseFlags,
	type ExtractedClauseFlag
} from './contract-extraction';

const content = [
	'Art. 4 \u2013 Durata e rinnovo',
	'Il presente contratto si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta.',
	'',
	'Art. 9 \u2013 Disposizioni finali',
	'Il contratto cesser\u00e0 automaticamente alla scadenza senza necessit\u00e0 di disdetta e senza possibilit\u00e0 di rinnovo tacito o automatico.'
].join('\n');

function validFields(overrides: Record<string, unknown> = {}) {
	return {
		client: {
			legalName: 'Vetraria del Garda S.p.A.',
			taxId: '02871450230',
			vatId: null,
			country: 'IT',
			addressLine1: 'Via Industriale 8',
			addressLine2: null,
			addressCity: 'Desenzano del Garda',
			addressPostalCode: '25015',
			addressRegion: null
		},
		contract: {
			title: 'Contratto di Consulenza Professionale',
			signedDocumentReference: 'Rep. n. 14/2025',
			startsOn: '2025-09-01',
			endsOn: '2026-08-31',
			renewalType: 'none',
			renewalNoticeDays: null,
			terminationNoticeDays: 45,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'IVA ordinaria 22%',
			requiresPriorApproval: true,
			requiresExpensePreAuthorisation: true,
			expensePolicy: { kind: 'reimbursed_at_cost' }
		},
		rateCards: [
			{
				validFrom: '2025-09-01',
				validTo: null,
				kind: 'daily',
				amount: 650,
				unit: 'day',
				allowedFractions: [1, 0.5],
				minimumHours: null,
				disbursementPeriod: null
			}
		],
		clauseFlags: [],
		...overrides
	};
}

test('a well-formed answer parses, including nullable business fields left as given', () => {
	const candidate = parseExtractedContract(validFields());
	expect(candidate.client.legalName).toBe('Vetraria del Garda S.p.A.');
	expect(candidate.contract.renewalType).toBe('none');
	expect(candidate.contract.paymentTerms).toEqual({ kind: 'net', days: 30 });
	expect(candidate.rateCards).toHaveLength(1);
	expect(candidate.clauseFlags).toHaveLength(0);
});

test('day_of_month payment terms always come back with monthOffset fixed at 1', () => {
	const candidate = parseExtractedContract(
		validFields({
			contract: {
				...validFields().contract,
				paymentTerms: { kind: 'day_of_month', day: 10 }
			}
		})
	);
	expect(candidate.contract.paymentTerms).toEqual({
		kind: 'day_of_month',
		day: 10,
		monthOffset: 1
	});
});

test('a reimbursed_with_cap expense policy carries capAmount as minor units', () => {
	const candidate = parseExtractedContract(
		validFields({
			contract: {
				...validFields().contract,
				expensePolicy: { kind: 'reimbursed_with_cap', capAmount: 50000 }
			}
		})
	);
	expect(candidate.contract.expensePolicy).toEqual({
		kind: 'reimbursed_with_cap',
		capAmount: 50000
	});
});

test('an ambiguous renewal clause reports the field as null and requires the flag', () => {
	const candidate = parseExtractedContract(
		validFields({
			contract: { ...validFields().contract, renewalType: null },
			clauseFlags: [
				{
					field: 'contract.renewalType',
					clauseReference: 'Art. 4 e Art. 9',
					verbatimText:
						'si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta ... cesser\u00e0 automaticamente alla scadenza senza necessit\u00e0 di disdetta',
					readings: [
						'tacit: Art. 4 controls, the contract renews unless notice is given',
						'none: Art. 9 controls, the contract ends on its fixed term with no renewal'
					]
				}
			]
		})
	);
	expect(candidate.contract.renewalType).toBeNull();
	expect(candidate.clauseFlags).toHaveLength(1);
	expect(candidate.clauseFlags[0].field).toBe('contract.renewalType');
});

// Rejected by `validateClauseFlags` rather than by the parser, on purpose:
// a real run produced one malformed flag beside a correct extraction, and
// failing the parse threw away everything the model had got right. The
// flag is still refused, with its reason — it is simply no longer fatal to
// its siblings.
test('a clause flag with only one reading is rejected, with its reason, not silently accepted', () => {
	const document = 'a clause long enough to be evidence on its own, quoted in the document';
	const candidate = parseExtractedContract(
		validFields({
			clauseFlags: [
				{
					field: 'contract.renewalType',
					clauseReference: 'Art. 4',
					verbatimText: 'a clause long enough to be evidence on its own',
					readings: ['only one reading']
				}
			]
		})
	);
	const flags = validateClauseFlags(candidate.clauseFlags, document);
	expect(flags.accepted).toHaveLength(0);
	expect(flags.rejected).toHaveLength(1);
	expect(flags.rejected[0].reason).toMatch(/at least two distinct readings/);
});

test('a missing required field throws naming it, never a best-effort guess', () => {
	const fields = validFields();
	// @ts-expect-error deliberately malformed input, the case under test
	delete fields.contract.title;
	expect(() => parseExtractedContract(fields)).toThrow(/contract.title/);
});

test('an empty rateCards array is refused: every contract this issue targets prices something', () => {
	expect(() => parseExtractedContract(validFields({ rateCards: [] }))).toThrow(/rateCards/);
});

test('a malformed paymentTerms.kind is refused rather than guessed at', () => {
	expect(() =>
		parseExtractedContract(
			validFields({
				contract: { ...validFields().contract, paymentTerms: { kind: 'weekly', days: 7 } }
			})
		)
	).toThrow();
});

function flag(overrides: Partial<ExtractedClauseFlag> = {}): ExtractedClauseFlag {
	return {
		field: 'contract.renewalType',
		clauseReference: 'Art. 4 e Art. 9',
		verbatimText: 'si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta',
		readings: ['reading one', 'reading two'],
		interpretationAdopted: null,
		...overrides
	};
}

test('a clause flag whose verbatimText is genuinely in the document is accepted', () => {
	const { accepted, rejected } = validateClauseFlags([flag()], content);
	expect(accepted).toHaveLength(1);
	expect(rejected).toHaveLength(0);
});

test('a clause flag that paraphrases rather than quotes is rejected, not silently kept', () => {
	const { accepted, rejected } = validateClauseFlags(
		[flag({ verbatimText: 'the contract renews itself automatically unless someone objects' })],
		content
	);
	expect(accepted).toHaveLength(0);
	expect(rejected).toHaveLength(1);
	expect(rejected[0].reason).toMatch(/not verbatim/);
});

test('a clause flag shorter than the minimum is rejected as not readable evidence', () => {
	const short = 'x'.repeat(MINIMUM_CLAUSE_LENGTH - 1);
	const { accepted, rejected } = validateClauseFlags([flag({ verbatimText: short })], content);
	expect(accepted).toHaveLength(0);
	expect(rejected[0].reason).toMatch(/too short/);
});

test('whitespace reflowed in a quoted clause still counts as verbatim', () => {
	const reflowed = 'si intende tacitamente\n\trinnovato   per ulteriori 12 mesi salvo disdetta';
	const { accepted } = validateClauseFlags([flag({ verbatimText: reflowed })], content);
	expect(accepted).toHaveLength(1);
});

test('contractConfidence passes the model\u2019s own confidence through when there are no flags', () => {
	expect(contractConfidence(0.9, 'looks clean', 0)).toEqual({
		confidence: 0.9,
		confidenceReason: 'looks clean'
	});
});

test('contractConfidence never raises confidence, and caps it once a clause is flagged', () => {
	expect(contractConfidence(0.95, null, 1)).toEqual({
		confidence: CLAUSE_FLAG_CONFIDENCE_CAP,
		confidenceReason: '1 clause reads more than one way and needs a human choice'
	});
});

test('contractConfidence folds the model\u2019s own low confidence with the flag reason', () => {
	const result = contractConfidence(0.1, 'a rate is a rough inference', 2);
	expect(result.confidence).toBe(0.1);
	expect(result.confidenceReason).toBe(
		'a rate is a rough inference; 2 clauses read more than one way and need a human choice'
	);
});

// A UK counterparty's agreement was read correctly in production on
// 2026-08-15, reported `taxId: null` exactly as the "never invent" rule
// asks, and was rejected by this parser with the reviewer told nothing —
// the client table has demanded only a legal name and a country since
// migration 0056, and this schema had not followed. Anything the document
// does not state stays null all the way to the review screen.
test('a counterparty with no tax id and no address is an ordinary client, not a malformed one', () => {
	const parsed = parseExtractedContract(
		validFields({
			client: {
				legalName: 'Visum Labs Ltd',
				taxId: null,
				vatId: null,
				country: 'GB',
				addressLine1: null,
				addressLine2: null,
				addressCity: null,
				addressPostalCode: null,
				addressRegion: null
			}
		})
	);

	expect(parsed.client.legalName).toBe('Visum Labs Ltd');
	expect(parsed.client.country).toBe('GB');
	expect(parsed.client.taxId).toBeNull();
	expect(parsed.client.addressLine1).toBeNull();
	expect(parsed.client.addressCity).toBeNull();
	expect(parsed.client.addressPostalCode).toBeNull();
});

test('a counterparty with no legal name is still refused', () => {
	expect(() =>
		parseExtractedContract(validFields({ client: { legalName: '  ', country: 'IT' } }))
	).toThrow();
});

test('a counterparty with no country is still refused', () => {
	expect(() =>
		parseExtractedContract(validFields({ client: { legalName: 'Visum Labs Ltd', country: null } }))
	).toThrow();
});

// #379: a contract document that says nothing about a surcharge has not
// agreed to one. Defaulting the other way would invoice a client 4% nobody
// wrote down, which is a dispute rather than a rounding difference. The
// fixture above deliberately does not mention it, which is the realistic
// case: no contract PDF this product has seen so far does.
test('a contract that says nothing about the social charge does not elect it', () => {
	const candidate = parseExtractedContract(validFields());

	expect(candidate.contract.appliesSocialCharge).toBe(false);
});

test('a contract that does state the social charge keeps it', () => {
	const base = validFields();
	const fields = {
		...base,
		contract: { ...base.contract, appliesSocialCharge: true }
	};

	const candidate = parseExtractedContract(fields);

	expect(candidate.contract.appliesSocialCharge).toBe(true);
});
