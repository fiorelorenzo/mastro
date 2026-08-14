// The real thing, kept: `contract-model-response.txt` is a verbatim
// response from Claude through the ACP runner, on the contract text in
// `contract-document.txt`, captured 2026-08-14. It is here because the run
// found two defects a fabricated fixture never would have.
//
// The model answered the central question of #86 correctly — it left
// `renewalType` null and flagged Art. 4 with two readings — and the
// pipeline threw the whole thing away anyway, twice over: `taxTreatment`
// was required where the document simply does not state one, and a single
// malformed second flag failed the schema for the entire payload. Both are
// the worst kind of failure, because they read as the model getting the
// contract wrong when it had every field right.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { stripCodeFence } from '../runner/job';
import {
	parseExtractedContract,
	validateClauseFlags,
	contractConfidence
} from './contract-extraction';

const here = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const response = readFileSync(`${here}contract-model-response.txt`, 'utf8');
const document = readFileSync(`${here}contract-document.txt`, 'utf8');

function parseFixture() {
	const envelope = JSON.parse(stripCodeFence(response)) as Record<string, unknown>;
	return {
		envelope,
		candidate: parseExtractedContract(envelope.proposedFields as Record<string, unknown>)
	};
}

test('a real model response parses, fenced JSON and all', () => {
	const { envelope, candidate } = parseFixture();
	expect(envelope.excerpt).toContain('Meridiana Software Solutions');
	expect(candidate.client.taxId).toBe('04455667788');
	expect(candidate.contract.startsOn).toBe('2026-02-01');
	expect(candidate.contract.endsOn).toBe('2027-01-31');
	expect(candidate.contract.terminationNoticeDays).toBe(30);
	expect(candidate.contract.paymentTerms).toEqual({ kind: 'net', days: 30 });
	expect(candidate.contract.requiresPriorApproval).toBe(true);
	expect(candidate.rateCards[0].amount).toBe(620);
	expect(candidate.rateCards[0].allowedFractions).toEqual([1, 0.5]);
});

test('a contract that states no tax treatment still parses', () => {
	// The document names no regime, so the model sent null. Requiring a
	// string here discarded a correct extraction; the accept path is what
	// refuses an unexplained null, not the parser.
	const { candidate } = parseFixture();
	expect(candidate.contract.taxTreatment).toBeNull();
});

test('the ambiguous renewal clause is flagged, not decided', () => {
	const { candidate } = parseFixture();
	expect(candidate.contract.renewalType).toBeNull();
	const flags = validateClauseFlags(candidate.clauseFlags, document);
	expect(flags.accepted).toHaveLength(1);
	expect(flags.accepted[0].field).toBe('contract.renewalType');
	expect(flags.accepted[0].clauseReference).toBe('Art. 4');
	expect(flags.accepted[0].readings.length).toBeGreaterThanOrEqual(2);
	expect(document).toContain(flags.accepted[0].verbatimText.slice(0, 40));
});

test('one malformed flag costs its own flag, not the extraction', () => {
	const { candidate } = parseFixture();
	const flags = validateClauseFlags(candidate.clauseFlags, document);
	expect(flags.rejected).toHaveLength(1);
	expect(flags.rejected[0].reason).toBe('the flag cites no clause');
});

test('an accepted flag caps the confidence the proposal carries', () => {
	const { envelope, candidate } = parseFixture();
	const flags = validateClauseFlags(candidate.clauseFlags, document);
	const { confidence, confidenceReason } = contractConfidence(
		envelope.confidence as number,
		envelope.confidenceReason as string | null,
		flags.accepted.length
	);
	expect(confidence).toBeLessThan(envelope.confidence as number);
	expect(confidenceReason).toContain('human choice');
});
