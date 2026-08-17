import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { document } from '$lib/server/db/schema';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import {
	proposeContractFromPdf,
	writeContractProposal,
	type RunExtraction
} from './contract-producer';

/** #86. The model is scripted here, the same way `day-producer.test.ts`
 * scripts it for day extraction: what a real one answers is
 * `docs/agent-runner.md`'s own trial's question, and what this file
 * proves is that one archived, first-intake PDF becomes one proposal
 * carrying the right shape — never a contract row, which only accepting
 * the proposal writes. */
async function seedUnclaimedDocument(tx: DbExecutor) {
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'b'.repeat(64),
			mime: 'application/pdf',
			size: 4096,
			originalName: 'contract-a-day-rate-approval.pdf',
			provenance: 'upload',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		})
		.returning();
	return documentRow;
}

const content = [
	'CONTRATTO DI CONSULENZA PROFESSIONALE',
	'tra Vetraria del Garda S.p.A. (P.IVA 02871450230) e dott. Elia Fontana',
	'',
	'Art. 4 \u2013 Durata e rinnovo',
	'Il presente contratto si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta.',
	'',
	'Art. 9 \u2013 Disposizioni finali',
	'Il contratto cesser\u00e0 automaticamente alla scadenza senza necessit\u00e0 di disdetta.'
].join('\n');

const excerpt = 'tra Vetraria del Garda S.p.A. (P.IVA 02871450230) e dott. Elia Fontana';

function validContractFields(clauseFlags: Record<string, unknown>[] = []): Record<string, unknown> {
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
			renewalType: clauseFlags.length > 0 ? null : 'none',
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
		clauseFlags
	};
}

const answer = (proposedFields: Record<string, unknown>, over: Partial<ProposalCandidate> = {}) => {
	const runExtraction: RunExtraction = async (request) =>
		({
			documentId: request.documentId,
			contractId: request.contractId,
			targetType: request.targetType,
			proposedFields,
			excerpt,
			confidence: 0.9,
			...over
		}) satisfies ProposalCandidate;
	return runExtraction;
};

test('a well-formed contract PDF becomes one pending proposal, contract_id still null', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);

		const { proposal, rejectedFlags } = await proposeContractFromPdf(
			{ documentId: documentRow.id, content },
			answer(validContractFields()),
			tx
		);

		expect(rejectedFlags).toEqual([]);
		expect(proposal.targetType).toBe('contract');
		expect(proposal.contractId).toBeNull();
		expect(proposal.status).toBe('pending');
		expect(proposal.excerpt).toBe(excerpt);
		const fields = proposal.proposedFields as Record<string, unknown>;
		expect((fields.client as Record<string, unknown>).legalName).toBe('Vetraria del Garda S.p.A.');
		expect((fields.contract as Record<string, unknown>).renewalType).toBe('none');
	});
});

test('the central case: an ambiguous renewal clause is flagged, not decided, and the field comes back null', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		const flag = {
			field: 'contract.renewalType',
			clauseReference: 'Art. 4 e Art. 9',
			verbatimText: 'si intende tacitamente rinnovato per ulteriori 12 mesi salvo disdetta',
			readings: [
				'tacit: Art. 4 controls, the contract renews unless notice is given',
				'none: Art. 9 controls, the contract ends on its fixed term'
			]
		};

		const { proposal, rejectedFlags } = await proposeContractFromPdf(
			{ documentId: documentRow.id, content },
			answer(validContractFields([flag])),
			tx
		);

		expect(rejectedFlags).toEqual([]);
		const fields = proposal.proposedFields as Record<string, unknown>;
		expect((fields.contract as Record<string, unknown>).renewalType).toBeNull();
		const writtenFlags = fields.clauseFlags as Record<string, unknown>[];
		expect(writtenFlags).toHaveLength(1);
		expect(writtenFlags[0].verbatimText).toBe(flag.verbatimText);
		expect(writtenFlags[0].interpretationAdopted).toBeNull();
		// A flagged proposal reads as needing review: confidence is capped
		// below the review screen's 0.5 threshold even though the model's
		// own confidence was 0.9.
		expect(proposal.confidence).toBeLessThan(0.5);
		expect(proposal.confidenceReason).toMatch(/reads more than one way/);
	});
});

test('a clause flag that paraphrases rather than quotes the document is dropped, not silently kept', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		const flag = {
			field: 'contract.renewalType',
			clauseReference: 'Art. 4',
			verbatimText: 'the contract renews itself automatically, more or less',
			readings: ['reading one', 'reading two']
		};

		const { proposal, rejectedFlags } = await proposeContractFromPdf(
			{ documentId: documentRow.id, content },
			answer(validContractFields([flag])),
			tx
		);

		expect(rejectedFlags).toHaveLength(1);
		expect(rejectedFlags[0].reason).toMatch(/not verbatim/);
		const fields = proposal.proposedFields as Record<string, unknown>;
		expect(fields.clauseFlags).toEqual([]);
		// The field the dropped flag would have explained stays whatever
		// the model reported — null here — with nothing left to justify
		// it; `proposalValidationIssue` is what refuses to accept that.
		expect((fields.contract as Record<string, unknown>).renewalType).toBeNull();
	});
});

test('a top-level excerpt that is not verbatim in the document is a loud failure, never a proposal', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);

		await expect(
			proposeContractFromPdf(
				{ documentId: documentRow.id, content },
				answer(validContractFields(), { excerpt: 'this sentence is nowhere in the document' }),
				tx
			)
		).rejects.toThrow(/not verbatim/);
	});
});

test('writeContractProposal is the write-only half drain.ts uses for an already-completed job', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		const candidate: ProposalCandidate = {
			documentId: documentRow.id,
			contractId: null,
			targetType: 'contract',
			proposedFields: validContractFields(),
			excerpt,
			confidence: 0.9
		};

		const { proposal } = await writeContractProposal(
			{ documentId: documentRow.id, content },
			candidate,
			tx
		);
		expect(proposal.documentId).toBe(documentRow.id);
	});
});
