import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, proposal } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise `0028_proposal_constraints.sql`, the database-level half of
// #83's acceptance. `repositories/proposal.test.ts` covers the repository
// orchestration on top, including the "no bypass" proof.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	counter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${counter}`,
			taxId: `TEST-TAX-${counter}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

async function insertDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string,
	// A second call on the same contract needs a distinct hash — nothing
	// else about the row matters to the trigger tests that use two.
	hash = 'e'.repeat(64)
) {
	const [row] = await tx
		.insert(document)
		.values({
			hash,
			mime: 'message/rfc822',
			size: 256,
			originalName: 'approval.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		})
		.returning();
	return row;
}

function proposalFields(
	contractId: string,
	documentId: string,
	overrides: Partial<typeof proposal.$inferInsert> = {}
) {
	return {
		documentId,
		contractId,
		targetType: 'work_unit' as const,
		proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
		excerpt: 'ok for Monday',
		confidence: 0.9,
		...overrides
	};
}

test('a well-formed proposal is accepted, defaulting to pending with no decision', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id))
			.returning();

		expect(row.status).toBe('pending');
		expect(row.acceptedFields).toBeNull();
		expect(row.resultId).toBeNull();
		expect(row.decidedBy).toBeNull();
		expect(row.decidedAt).toBeNull();
	});
});

test('a blank excerpt is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(proposalFields(contractRow.id, documentRow.id, { excerpt: '   ' })),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_excerpt_not_blank' });
	});
});

test('a blank confidence_reason is rejected by the database, but null is fine', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(proposalFields(contractRow.id, documentRow.id, { confidenceReason: '   ' })),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_confidence_reason_not_blank' });

		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id, { confidenceReason: null }))
			.returning();
		expect(row.confidenceReason).toBeNull();
	});
});

test('validation_issue stores a structured issue, and null is fine too', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		const [row] = await tx
			.insert(proposal)
			.values(
				proposalFields(contractRow.id, documentRow.id, {
					validationIssue: {
						code: 'must_be_positive',
						field: 'quantity',
						index: null,
						params: { value: -1 }
					}
				})
			)
			.returning();
		expect(row.validationIssue).toEqual({
			code: 'must_be_positive',
			field: 'quantity',
			index: null,
			params: { value: -1 }
		});

		const [nullRow] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id, { validationIssue: null }))
			.returning();
		expect(nullRow.validationIssue).toBeNull();
	});
});

test('a confidence outside 0..1 is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(proposalFields(contractRow.id, documentRow.id, { confidence: 1.5 })),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_confidence_range' });

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(proposalFields(contractRow.id, documentRow.id, { confidence: -0.1 })),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_confidence_range' });
	});
});

// `'invoice'` was this test's unknown value until #87 made it known, and
// `'contract'` until #86 did. `'expense'` is a target nothing proposes yet.
test('a target_type outside the known set is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(
							proposalFields(contractRow.id, documentRow.id, { targetType: 'expense' as never })
						),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_target_type_known' });
	});
});

test('an accepted status with no decision recorded is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx
						.insert(proposal)
						.values(proposalFields(contractRow.id, documentRow.id, { status: 'accepted' })),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_decision_shape' });
	});
});

test('a pending status carrying a decision is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);

		expect(
			await rejection(
				() =>
					tx.insert(proposal).values(
						proposalFields(contractRow.id, documentRow.id, {
							decidedBy: 'lorenzo@example.com',
							decidedAt: new Date()
						})
					),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'proposal_decision_shape' });
	});
});

// Task 5 (#403 revised, 0075_proposal_pending_reading_is_mutable.sql):
// `proposal_forbid_retrofit` used to forbid every one of these columns from
// ever changing. It now splits them: `contract_id`/`target_type` are the
// proposal's identity and stay immutable at any status; `document_id`,
// `proposed_fields`, `excerpt`, `confidence`, `confidence_reason` and
// `validation_issue` are its current reading, mutable only while the row is
// still `pending` — a re-read rewrites them in place
// (`reviseDayProposal` in `repositories/proposal.ts`), and the same second
// rule as before freezes all of it, reading included, the moment a human
// decides.
test('contract_id and target_type stay immutable, even on a pending proposal', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const otherContract = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id))
			.returning();
		expect(row.status).toBe('pending');

		expect(
			(
				await rejection(
					() =>
						tx
							.update(proposal)
							.set({ contractId: otherContract.id })
							.where(eq(proposal.id, row.id)),
					tx
				)
			).message
		).toMatch(/immutable/);

		expect(
			(
				await rejection(
					() => tx.update(proposal).set({ targetType: 'invoice' }).where(eq(proposal.id, row.id)),
					tx
				)
			).message
		).toMatch(/immutable/);
	});
});

test('a pending proposal\u2019s reading — document, fields, excerpt, confidence and validation issue — can be rewritten while it waits for a decision', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const secondDocument = await insertDocument(tx, contractRow.id, 'f'.repeat(64));
		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id, { confidenceReason: 'a reason' }))
			.returning();

		const [revised] = await tx
			.update(proposal)
			.set({
				documentId: secondDocument.id,
				proposedFields: { date: '2024-06-11', quantity: 0.5, scope: 'a later reading' },
				excerpt: 'a different sentence entirely',
				confidence: 0.4,
				confidenceReason: 'a different reason',
				validationIssue: {
					code: 'must_be_positive',
					field: 'quantity',
					index: null,
					params: { value: -1 }
				}
			})
			.where(eq(proposal.id, row.id))
			.returning();

		expect(revised.documentId).toBe(secondDocument.id);
		expect(revised.proposedFields).toEqual({
			date: '2024-06-11',
			quantity: 0.5,
			scope: 'a later reading'
		});
		expect(revised.excerpt).toBe('a different sentence entirely');
		expect(revised.confidence).toBe(0.4);
		expect(revised.confidenceReason).toBe('a different reason');
		expect(revised.validationIssue).toEqual({
			code: 'must_be_positive',
			field: 'quantity',
			index: null,
			params: { value: -1 }
		});
		expect(revised.status).toBe('pending');
	});
});

test('once a proposal is decided, its reading is frozen too — a decision is final', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const secondDocument = await insertDocument(tx, contractRow.id, 'f'.repeat(64));
		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id))
			.returning();

		await tx
			.update(proposal)
			.set({
				status: 'rejected',
				decidedBy: 'lorenzo@example.com',
				decidedAt: new Date()
			})
			.where(eq(proposal.id, row.id));

		expect(
			(
				await rejection(
					() =>
						tx
							.update(proposal)
							.set({ excerpt: 'a different sentence entirely' })
							.where(eq(proposal.id, row.id)),
					tx
				)
			).message
		).toMatch(/already been decided/);

		expect(
			(
				await rejection(
					() =>
						tx
							.update(proposal)
							.set({ documentId: secondDocument.id })
							.where(eq(proposal.id, row.id)),
					tx
				)
			).message
		).toMatch(/already been decided/);
	});
});

test('a proposal can move from pending to accepted exactly once', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertDocument(tx, contractRow.id);
		const [row] = await tx
			.insert(proposal)
			.values(proposalFields(contractRow.id, documentRow.id))
			.returning();

		const [decided] = await tx
			.update(proposal)
			.set({
				status: 'accepted',
				acceptedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
				resultId: crypto.randomUUID(),
				decidedBy: 'lorenzo@example.com',
				decidedAt: new Date()
			})
			.where(eq(proposal.id, row.id))
			.returning();
		expect(decided.status).toBe('accepted');

		expect(
			(
				await rejection(
					() => tx.update(proposal).set({ status: 'rejected' }).where(eq(proposal.id, row.id)),
					tx
				)
			).message
		).toMatch(/already been decided/);
	});
});
