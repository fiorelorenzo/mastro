import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	client,
	contract,
	document,
	proposal,
	rateCard,
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
						excerpt: 'le giornate del 3'
					},
					{
						date: '2026-02-04',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: 'la seconda mezza'
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
					{ date: '2026-02-05', quantity: 0.33, scope: 'Call', excerpt: 'Un terzo di giornata' },
					{ date: '2026-02-06', quantity: 1, scope: 'Sviluppo', excerpt: 'una piena venerdì' }
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
						excerpt: 'confermo dal 29 dicembre'
					},
					{
						date: '2027-01-01',
						quantity: 1,
						scope: 'Analisi',
						excerpt: 'al 2 gennaio, giornata intera'
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
