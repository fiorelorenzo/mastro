import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	client,
	contract,
	document,
	proposal,
	rateCard,
	workUnit,
	type ExpensePolicy
} from '$lib/server/db/schema';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { YEAR_ROLLOVER_CONFIDENCE_CAP } from './day-extraction';
import { proposeDaysFromMessage, type RunExtraction } from './day-producer';

/** #85. The model is scripted here: what a real one answers is the
 * corpus's question (`scripts/score-day-corpus.ts`), and what this file
 * proves is that one message becomes the right rows, or none at all. */
async function seed(tx: DbExecutor) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: 'Day Producer SRL',
			taxId: `IT${Date.now()}`,
			country: 'IT',
			addressLine1: 'Via Prova 1',
			addressCity: 'Milano',
			addressPostalCode: '20121',
			noticeChannel: 'email'
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Contratto quadro 2026',
			startsOn: '2026-01-01',
			endsOn: '2026-12-31',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	await tx.insert(rateCard).values({
		contractId: contractRow.id,
		validFrom: '2026-01-01',
		kind: 'daily',
		amount: 650,
		unit: 'day',
		allowedFractions: [1, 0.5]
	});
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'a'.repeat(64),
			mime: 'message/rfc822',
			size: 128,
			originalName: 'thread.eml',
			provenance: 'mail',
			contractId: contractRow.id,
			confidential: false,
			ownerType: 'contract',
			ownerId: contractRow.id
		})
		.returning();
	return { contractRow, documentRow };
}

/** A second archived message on the same contract, for the tests that
 * check `messageIndex` resolves a day to a specific message's document
 * rather than always the newest one (#400). */
async function seedDocument(tx: DbExecutor, contractId: string, originalName: string) {
	const [row] = await tx
		.insert(document)
		.values({
			hash: Buffer.from(originalName).toString('hex').padEnd(64, '0').slice(0, 64),
			mime: 'message/rfc822',
			size: 96,
			originalName,
			provenance: 'mail',
			contractId,
			confidential: false,
			ownerType: 'contract',
			ownerId: contractId
		})
		.returning();
	return row;
}

const answer = (proposedFields: Record<string, unknown>): RunExtraction => {
	return async (request) =>
		({
			documentId: request.documentId,
			contractId: request.contractId,
			targetType: request.targetType,
			proposedFields,
			excerpt: 'ti confermo le giornate del 3 e 4 febbraio, la seconda mezza',
			confidence: 0.82
		}) satisfies ProposalCandidate;
};

test('one message with two days becomes two proposals, each carrying its own span', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);

		const { proposals, rejected } = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'Ciao, ti confermo le giornate del 3 e 4 febbraio, la seconda mezza.',
				messageDate: '2026-02-02',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'le giornate del 3',
						messageIndex: 0
					},
					{
						date: '2026-02-04',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'la seconda mezza',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		expect(rejected).toEqual([]);
		expect(proposals.map((row) => row.proposedFields)).toEqual([
			{ date: '2026-02-03', quantity: 1, scope: 'Analisi' },
			{ date: '2026-02-04', quantity: 0.5, scope: 'Analisi' }
		]);
		// Each row carries the span that justifies it, not the message's
		// whole approval sentence: a reviewer checking the Friday should
		// not have to read about the Thursday.
		expect(proposals.map((row) => row.excerpt)).toEqual(['le giornate del 3', 'la seconda mezza']);
		expect(proposals.every((row) => row.status === 'pending')).toBe(true);
	});
});

test('a message that approves nothing writes no proposal at all', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);

		const { proposals } = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'Ti mando il contratto firmato, ci sentiamo la settimana prossima.',
				messageDate: '2026-02-02',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({ days: [] }),
			tx
		);

		expect(proposals).toEqual([]);
		const rows = await tx.select().from(proposal).where(eq(proposal.documentId, documentRow.id));
		expect(rows).toEqual([]);
	});
});

test('a day the contract cannot sell is reported, not written', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);

		const { proposals, rejected } = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'Un terzo di giornata giovedì e una piena venerdì.',
				messageDate: '2026-02-02',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-05',
						quantity: 0.33,
						scope: 'Call',
						excerpt: 'Un terzo di giornata',
						messageIndex: 0
					},
					{
						date: '2026-02-06',
						quantity: 1,
						scope: 'Sviluppo',
						excerpt: 'una piena venerdì',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		expect(proposals).toHaveLength(1);
		expect(proposals[0].proposedFields).toMatchObject({ date: '2026-02-06' });
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toMatch(/rate cards sell/);
	});
});

test('#244: a day the year-rollover guard catches is still written, capped at the guard\u2019s confidence ceiling', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);

		const { proposals, rejected } = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'Ciao, confermo dal 29 dicembre al 2 gennaio, giornata intera.',
				messageDate: '2026-12-15',
				startsOn: contractRow.startsOn,
				// Open-ended so the day rolling into next year is not refused
				// by the ordinary contract-term check — the guard, not that
				// check, is what this test is about.
				endsOn: null
			},
			answer({
				days: [
					{
						date: '2026-12-29',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'confermo dal 29 dicembre',
						messageIndex: 0
					},
					{
						date: '2027-01-01',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'al 2 gennaio, giornata intera',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		expect(rejected).toEqual([]);
		expect(proposals).toHaveLength(2);
		// Same year, well within 60 days: nothing to flag.
		expect(proposals[0].confidence).toBe(0.82);
		expect(proposals[0].confidenceReason).toBeNull();
		// A different calendar year than the message: capped and explained,
		// never left to read as settled just because the model was sure.
		expect(proposals[1].confidence).toBeLessThanOrEqual(YEAR_ROLLOVER_CONFIDENCE_CAP);
		expect(proposals[1].confidenceReason).toMatch(/different calendar year/);
	});
});

test('#400: a day\u2019s messageIndex resolves to the message that actually carries it, not the newest one', () => {
	return inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow: offerDocument } = await seed(tx);
		// The owner's "confermo" is a second, later message — a real
		// conversation, not a single archived email. `documentRow` above is
		// the offer (message 0); this is the acceptance (message 1) and the
		// one `documentId` points at per invariant, the newest.
		const acceptanceDocument = await seedDocument(tx, contractRow.id, 'polymarket-acceptance.eml');

		const { proposals, rejected } = await proposeDaysFromMessage(
			{
				documentId: acceptanceDocument.id,
				contractId: contractRow.id,
				content:
					'--- message 0, 2026-08-03, client@example.com ---\n' +
					'ti confermo l\u2019allocazione di mezza giornata per i meeting con Polymarket. ' +
					'Attivit\u00e0: partecipazione ai meeting w/c 03/08. Allocazione: 0,5 giornata.\n\n' +
					'--- message 1, 2026-08-04, owner@example.com ---\n' +
					'tutto ok, confermo',
				messageDate: '2026-08-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn,
				conversation: [
					{
						documentId: offerDocument.id,
						sentAt: '2026-08-03',
						from: 'client@example.com',
						body: 'ti confermo l\u2019allocazione di mezza giornata per i meeting con Polymarket. Attivit\u00e0: partecipazione ai meeting w/c 03/08. Allocazione: 0,5 giornata.'
					},
					{
						documentId: acceptanceDocument.id,
						sentAt: '2026-08-04',
						from: 'owner@example.com',
						body: 'tutto ok, confermo'
					}
				]
			},
			answer({
				days: [
					{
						date: '2026-08-03',
						quantity: 0.5,
						scope: 'Meeting Polymarket',
						excerpt: 'partecipazione ai meeting w/c 03/08',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		expect(rejected).toEqual([]);
		expect(proposals).toHaveLength(1);
		// The evidence is the offer, message 0, so the proposal has to
		// archive against the offer's own document — not the acceptance,
		// even though the acceptance is `documentId` above and the newest
		// message of the two.
		expect(proposals[0].documentId).toBe(offerDocument.id);
	});
});

test('#400: with no conversation array, a day still archives against the source document', () => {
	return inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);

		const { proposals } = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'Ciao, ti confermo il 3 febbraio.',
				messageDate: '2026-02-02',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
				// No `conversation`: a hand-uploaded single message, or a
				// candidate drained from before #400 existed.
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'ti confermo il 3 febbraio',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		expect(proposals).toHaveLength(1);
		expect(proposals[0].documentId).toBe(documentRow.id);
	});
});

test('a second read of a conversation offers only what is new (#403)', async () => {
	// The shape a repeated sync produces: the 3rd was proposed when the
	// conversation was first read and is still waiting for a decision, the
	// 4th was accepted and is on the ledger, and today's reply adds the 5th.
	// Re-reading gives the model all three again, because it must see the
	// offer to understand the answer; only the 5th is news.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(proposal).values({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'work_unit',
			proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
			excerpt: 'le giornate del 3',
			confidence: 0.8,
			status: 'pending'
		});
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-04',
			quantity: 0.5,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		return proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'ti confermo le giornate del 3 e 4 febbraio, la seconda mezza, e anche il 5',
				messageDate: '2026-02-05',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'le giornate del 3',
						messageIndex: 0
					},
					{
						date: '2026-02-04',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'e 4 febbraio',
						messageIndex: 0
					},
					{
						date: '2026-02-05',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'e anche il 5',
						messageIndex: 0
					}
				]
			}),
			tx
		);
	});

	// One new proposal, and the two the ledger already holds are reported as
	// rejected rather than dropped, so a run that found nothing new says so.
	expect(result.proposals.map((row) => row.proposedFields)).toEqual([
		expect.objectContaining({ date: '2026-02-05' })
	]);
	expect(result.rejected.map((entry) => entry.reason)).toEqual([
		'2026-02-03 is already proposed or recorded on this contract',
		'2026-02-04 is already proposed or recorded on this contract'
	]);
});
