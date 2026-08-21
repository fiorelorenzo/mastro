import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	client,
	contract,
	dayReadingConflict,
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

test('a second read of a conversation revises the pending day, suppresses the recorded one, and adds what is new (#403, revised by Task 5)', async () => {
	// The shape a repeated sync produces: the 3rd was proposed when the
	// conversation was first read and is still waiting for a decision, the
	// 4th was accepted and is on the ledger, and today's reply adds the 5th.
	// Re-reading gives the model all three again, because it must see the
	// offer to understand the answer. The 4th, recorded, is still suppressed
	// — a human decided it. The 3rd, only pending, is no longer suppressed:
	// it is rewritten in place (Task 5), same id, same document, refreshed
	// reading. Only the 5th is a brand new row.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const [existing] = await tx
			.insert(proposal)
			.values({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
				excerpt: 'le giornate del 3',
				confidence: 0.8,
				status: 'pending'
			})
			.returning();
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-04',
			quantity: 0.5,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		const outcome = await proposeDaysFromMessage(
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
		return { outcome, existingId: existing.id };
	});

	// Two proposals: the 3rd, revised in place (same id), and the 5th, new.
	// The 4th is not among them — it is on the ledger, not proposed again.
	expect(result.outcome.proposals.map((row) => row.proposedFields)).toEqual([
		expect.objectContaining({ date: '2026-02-03' }),
		expect.objectContaining({ date: '2026-02-05' })
	]);
	expect(result.outcome.proposals[0].id).toBe(result.existingId);
	// Only the recorded day is reported as rejected; a pending one reaching
	// the writer is no longer a rejection at all.
	expect(result.outcome.rejected.map((entry) => entry.reason)).toEqual([
		'2026-02-04 is already recorded on this contract'
	]);
});

test('a re-read that re-attributes a day\u2019s evidence to a different message moves the proposal to that document too', async () => {
	// Task 5 + invariant 4: `excerpt` and `document_id` move together or not
	// at all (0075_proposal_pending_reading_is_mutable.sql) — a row whose
	// excerpt cannot be found in the document it names is exactly the
	// failure invariant 4 exists to prevent. The first read attributed the
	// day to the offer (message 0, tentative); the reply resolves it, and
	// the evidence a human should be shown now sits in message 1 instead.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow: offerDocument } = await seed(tx);
		const replyDocument = await seedDocument(tx, contractRow.id, 'reply.eml');
		const [existing] = await tx
			.insert(proposal)
			.values({
				documentId: offerDocument.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
				excerpt: 'forse il 3, da confermare',
				confidence: 0.5,
				status: 'pending'
			})
			.returning();

		const outcome = await proposeDaysFromMessage(
			{
				documentId: replyDocument.id,
				contractId: contractRow.id,
				content:
					'--- message 0, 2026-02-02, client@example.com ---\n' +
					'forse il 3, da confermare\n\n' +
					'--- message 1, 2026-02-03, client@example.com ---\n' +
					'confermo il 3, giornata intera',
				messageDate: '2026-02-03',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn,
				conversation: [
					{
						documentId: offerDocument.id,
						sentAt: '2026-02-02',
						from: 'client@example.com',
						body: 'forse il 3, da confermare'
					},
					{
						documentId: replyDocument.id,
						sentAt: '2026-02-03',
						from: 'client@example.com',
						body: 'confermo il 3, giornata intera'
					}
				]
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'confermo il 3, giornata intera',
						messageIndex: 1
					}
				]
			}),
			tx
		);

		const [after] = await tx.select().from(proposal).where(eq(proposal.id, existing.id));
		return { outcome, after, existingId: existing.id, replyDocumentId: replyDocument.id };
	});

	expect(result.outcome.proposals).toHaveLength(1);
	// Same row, same id: a link a reviewer already has open still resolves.
	expect(result.outcome.proposals[0].id).toBe(result.existingId);
	// But it now names the document the new excerpt actually came from, not
	// the one the first, tentative read pointed at — the review queue
	// (grouped by documentId) moves this row to that document's card, and
	// that is the correct effect of a corrected reading.
	expect(result.after.documentId).toBe(result.replyDocumentId);
	expect(result.after.excerpt).toBe('confermo il 3, giornata intera');
	expect(result.after.status).toBe('pending');
});

test('a second reading rewrites the pending proposal instead of dropping it', async () => {
	// The client wrote "half a day, not one" while the proposal was still
	// waiting. Suppressing the day (which the old always-decided query did)
	// kept the stale reading on screen and put the new one only in the run
	// log. The row is rewritten in place, keeping its id so a link somebody
	// has open still resolves.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const [existing] = await tx
			.insert(proposal)
			.values({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
				excerpt: 'la giornata del 3',
				confidence: 0.8,
				status: 'pending'
			})
			.returning();

		const outcome = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'in realt\u00e0 il 3 facciamo mezza giornata',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'il 3 facciamo mezza giornata',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		const [after] = await tx.select().from(proposal).where(eq(proposal.id, existing.id));
		return { outcome, after, existingId: existing.id };
	});

	// One proposal, the same one, with the new reading on it.
	expect(result.outcome.proposals).toHaveLength(1);
	expect(result.outcome.proposals[0].id).toBe(result.existingId);
	expect(result.after.proposedFields).toMatchObject({ quantity: 0.5 });
	expect(result.after.excerpt).toBe('il 3 facciamo mezza giornata');
	expect(result.after.status).toBe('pending');
	// Not asserting `updatedAt > createdAt` here: `now()` is frozen for the
	// whole transaction (`inRolledBackTransaction`), so the INSERT and the
	// UPDATE both stamp the identical instant and the two are equal, not
	// ordered. Task 4's `proposalRevised` reads the same two columns outside
	// a transaction, where they genuinely differ across two requests.
});

test('a date whose proposal was rejected can be proposed again', async () => {
	// A rejection says "not this proposal", not "never this day". A re-read
	// that understands the conversation better is the correction the reviewer
	// is owed, so a rejected date is in neither the recorded map nor the
	// pending map and reaches `createProposal` as if it were new.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(proposal).values({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'work_unit',
			proposedFields: { date: '2026-02-03', quantity: 1, scope: 'Analisi' },
			excerpt: 'la giornata del 3',
			confidence: 0.8,
			status: 'rejected',
			// `proposal_decision_shape` requires both once a row is decided.
			decidedBy: 'reviewer@example.com',
			decidedAt: new Date()
		});

		return proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'confermo la giornata del 3, mezza',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'la giornata del 3, mezza',
						messageIndex: 0
					}
				]
			}),
			tx
		);
	});

	// A new proposal, not a revision of the rejected one.
	expect(result.proposals).toHaveLength(1);
	expect(result.proposals[0].status).toBe('pending');
});

test('a reading that disagrees with a recorded day writes a conflict and no proposal, once, not on every re-read', async () => {
	// A day already on the ledger is a human's decision (invariant 3): the
	// producer must not re-propose it, but a reading that disagrees with
	// what is recorded is still a fact worth a reviewer's attention, kept
	// as a conflict row rather than silently dropped.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-03',
			quantity: 1,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		const request = {
			documentId: documentRow.id,
			contractId: contractRow.id,
			content: 'il 3 era mezza giornata',
			messageDate: '2026-02-04',
			startsOn: contractRow.startsOn,
			endsOn: contractRow.endsOn
		};
		const scripted = answer({
			days: [
				{
					date: '2026-02-03',
					quantity: 0.5,
					scope: 'Analisi',
					excerpt: 'il 3 era mezza giornata',
					messageIndex: 0
				}
			]
		});

		const outcome = await proposeDaysFromMessage(request, scripted, tx);
		// A second, unchanged re-read of the same conversation must not pile
		// a second row onto the same disagreement — the table is upserted
		// on `(contract_id, date)`, not appended to.
		const second = await proposeDaysFromMessage(request, scripted, tx);

		const conflicts = await tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractRow.id));
		return { outcome, second, conflicts };
	});

	expect(result.outcome.proposals).toHaveLength(0);
	expect(result.second.proposals).toHaveLength(0);
	expect(result.conflicts).toHaveLength(1);
	expect(result.conflicts[0].proposedFields).toMatchObject({ quantity: 0.5 });
	expect(result.conflicts[0].excerpt).toBe('il 3 era mezza giornata');
});

test('a reading that agrees with a recorded day writes no conflict', async () => {
	// Agreement is not news: a table that fills up with confirmations is a
	// table nobody reads.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-03',
			quantity: 1,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'confermo la giornata del 3',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'confermo la giornata del 3',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		return tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractRow.id));
	});

	expect(result).toHaveLength(0);
});

test('a rejected day sharing a date with a live one does not skew the recorded total', async () => {
	// `work_unit_one_active_per_contract_date` allows at most one *live* row
	// per (contract, date), but a dead row (rejected/revoked) can still
	// share the date with a live one — an earlier reading was rejected,
	// then a later one was recorded. `recordedByDate` must answer with the
	// live row's quantity, not "whichever row a plain `GROUP BY` or
	// "last one wins" pick happens to include" — summing every row
	// regardless of state (finding 1) or reading a per-date map built over
	// every state (finding 2) both reach the wrong total here, because the
	// rejected row's own quantity differs from the live one's.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const [rejectedRow] = await tx
			.insert(workUnit)
			.values({
				contractId: contractRow.id,
				date: '2026-02-03',
				quantity: 1,
				scope: 'Analisi',
				state: 'proposed'
			})
			.returning();
		await tx.update(workUnit).set({ state: 'rejected' }).where(eq(workUnit.id, rejectedRow.id));
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-02-03',
			quantity: 0.5,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		const outcome = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'il 3 mezza giornata',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'il 3 mezza giornata',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		const conflicts = await tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractRow.id));
		return { outcome, conflicts };
	});

	// The live row's own quantity (0.5) is what the re-read agrees with —
	// not the rejected row's (1), and not their sum (1.5).
	expect(result.outcome.proposals).toHaveLength(0);
	expect(result.outcome.rejected.map((entry) => entry.reason)).toEqual([
		'2026-02-03 is already recorded on this contract'
	]);
	expect(result.conflicts).toHaveLength(0);
});

test('a revoked day does not suppress its date or produce a false conflict', async () => {
	// Rejected and revoked are not "recorded" (`day-import.ts`'s
	// `DayImportExistingStateByKey`, `day-import-request.ts`'s
	// `existingStateByKeyForDayImport`, and the partial unique index on
	// `work_unit` itself all agree: a rejected or revoked day never
	// happened and does not occupy its date). A re-read proposing a day on
	// a date whose only work unit was revoked must be treated as a fresh
	// proposal, not suppressed as already recorded and not written as a
	// disagreement.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const [row] = await tx
			.insert(workUnit)
			.values({
				contractId: contractRow.id,
				date: '2026-02-03',
				quantity: 1,
				scope: 'Analisi',
				state: 'proposed'
			})
			.returning();
		await tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id));
		await tx.update(workUnit).set({ state: 'revoked' }).where(eq(workUnit.id, row.id));

		const outcome = await proposeDaysFromMessage(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				content: 'il 3 era una giornata intera',
				messageDate: '2026-02-04',
				startsOn: contractRow.startsOn,
				endsOn: contractRow.endsOn
			},
			answer({
				days: [
					{
						date: '2026-02-03',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'il 3 era una giornata intera',
						messageIndex: 0
					}
				]
			}),
			tx
		);

		const conflicts = await tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractRow.id));
		return { outcome, conflicts };
	});

	expect(result.outcome.rejected).toHaveLength(0);
	expect(result.outcome.proposals).toHaveLength(1);
	expect(result.conflicts).toHaveLength(0);
});
