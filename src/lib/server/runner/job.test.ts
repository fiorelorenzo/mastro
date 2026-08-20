import { afterAll, afterEach, expect, test } from 'vitest';
import { env } from '$env/dynamic/private';
import { client as pool } from '$lib/server/db';
import { connectRunnerDb, type RunnerDb } from './db.ts';
import { processExtractionJob } from './job.ts';
import type { ExtractionModel } from './model.ts';
import type { ExtractionRequest } from './types.ts';
import {
	deleteCommittedContract,
	deleteCommittedDocument,
	insertCommittedContract,
	insertCommittedDocument,
	insertCommittedUnclaimedDocument
} from './__fixtures__/db-fixtures.ts';

// Real database, real `mastro_runner` role — see db-privilege.test.ts.

if (!env.RUNNER_DATABASE_URL) {
	throw new Error('RUNNER_DATABASE_URL is not set; see .env.example');
}
const runnerDatabaseUrl = env.RUNNER_DATABASE_URL;

let runnerSql: RunnerDb;
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
});

afterAll(async () => {
	await runnerSql?.end();
	await pool.end();
});

const NEVER_CALL: ExtractionModel = {
	async call() {
		throw new Error('this model must never be called in this test');
	}
};

function baseRequest(overrides: Partial<ExtractionRequest>): ExtractionRequest {
	return {
		documentId: '',
		contractId: '',
		targetType: 'work_unit',
		content: 'ok for Thursday and Friday',
		instructions: 'extract days',
		...overrides
	};
}

test('a document that does not belong to the stated contract is rejected before any model call', async () => {
	const contractA = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractA.id, contractA.clientId));
	const contractB = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractB.id, contractB.clientId));
	const documentOfA = await insertCommittedDocument(contractA.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	// The strongest available proof that no model was reached: patch the
	// real global `fetch` to throw, so *any* code that tried to make a
	// network call — inside a model double, or inside a real
	// implementation using `fetch` rather than spawning a subprocess —
	// fails the test instead of silently succeeding.
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		throw new Error('network reached: no model may be invoked for a mismatched document');
	}) as typeof fetch;

	try {
		await expect(
			processExtractionJob(
				runnerSql,
				NEVER_CALL,
				baseRequest({ documentId: documentOfA.id, contractId: contractB.id })
			)
		).rejects.toThrow(/belongs to contract/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('a document id the runner cannot read at all is rejected', async () => {
	runnerSql = connectRunnerDb(runnerDatabaseUrl);
	await expect(
		processExtractionJob(
			runnerSql,
			NEVER_CALL,
			baseRequest({ documentId: crypto.randomUUID(), contractId: crypto.randomUUID() })
		)
	).rejects.toThrow(/does not exist/);
});

test('#86: a first-intake job (no contract on either side) is accepted, not treated as a mismatch', async () => {
	const documentRow = await insertCommittedUnclaimedDocument();
	cleanup.push(() => deleteCommittedDocument(documentRow.id));
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const model: ExtractionModel = {
		async call() {
			return {
				text: JSON.stringify({
					excerpt: 'Contratto di Consulenza — Rep. n. 1/2026',
					confidence: 0.8,
					proposedFields: { contract: { title: 'Contratto di Consulenza' } }
				})
			};
		}
	};

	const result = await processExtractionJob(
		runnerSql,
		model,
		baseRequest({ documentId: documentRow.id, contractId: null, targetType: 'contract' })
	);
	expect(result.contractId).toBeNull();
	expect(result.targetType).toBe('contract');
});

test('#86: a first-intake job claiming a real contract for an unclaimed document is rejected before any model call', async () => {
	const documentRow = await insertCommittedUnclaimedDocument();
	cleanup.push(() => deleteCommittedDocument(documentRow.id));
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	await expect(
		processExtractionJob(
			runnerSql,
			NEVER_CALL,
			baseRequest({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'contract'
			})
		)
	).rejects.toThrow(/belongs to contract null/);
});

test('a successful call returns a ProposalCandidate shaped from the model response', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const model: ExtractionModel = {
		async call() {
			return {
				text: JSON.stringify({
					excerpt: 'ok for Thursday',
					confidence: 0.75,
					proposedFields: { date: '2024-01-04', quantity: 1 }
				})
			};
		}
	};

	const result = await processExtractionJob(
		runnerSql,
		model,
		baseRequest({ documentId: documentRow.id, contractId: contractRow.id, targetType: 'work_unit' })
	);

	expect(result).toEqual({
		documentId: documentRow.id,
		contractId: contractRow.id,
		targetType: 'work_unit',
		excerpt: 'ok for Thursday',
		confidence: 0.75,
		proposedFields: { date: '2024-01-04', quantity: 1 }
	});
});

test('a successful call with a confidenceReason carries it through; a blank one is dropped', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const model: ExtractionModel = {
		async call() {
			return {
				text: JSON.stringify({
					excerpt: 'confermo dal 29 dicembre',
					confidence: 0.2,
					confidenceReason: '  the year is not written and the range crosses a boundary  ',
					proposedFields: { date: '2026-12-29', quantity: 1 }
				})
			};
		}
	};

	const result = await processExtractionJob(
		runnerSql,
		model,
		baseRequest({ documentId: documentRow.id, contractId: contractRow.id })
	);
	expect(result.confidenceReason).toBe('the year is not written and the range crosses a boundary');

	const blankModel: ExtractionModel = {
		async call() {
			return {
				text: JSON.stringify({
					excerpt: 'ok for Thursday',
					confidence: 0.9,
					confidenceReason: '',
					proposedFields: { date: '2024-01-04', quantity: 1 }
				})
			};
		}
	};
	const blankResult = await processExtractionJob(
		runnerSql,
		blankModel,
		baseRequest({ documentId: documentRow.id, contractId: contractRow.id })
	);
	expect(blankResult.confidenceReason).toBeUndefined();
});

test('a message that approves no days is a completed extraction with no proposal, not a failure', async () => {
	// The exact answer `day-extraction.ts` instructs the model to give:
	// `If the message approves no days, answer
	// {"proposedFields":{"days":[]},"excerpt":"","confidence":1}`. The parser
	// used to reject it for having a blank excerpt, so the prompt and the
	// parser contradicted each other and a model doing as it was told was
	// recorded as broken. Measured on the live instance: two of eight
	// extractions from a real mailbox failed this way, which also counts
	// toward `agent_run_failure` and reports a broken model where the truth
	// is that the message approved nothing.
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const model: ExtractionModel = {
		async call() {
			return {
				text: JSON.stringify({ proposedFields: { days: [] }, excerpt: '', confidence: 1 })
			};
		}
	};

	const result = await processExtractionJob(
		runnerSql,
		model,
		baseRequest({ documentId: documentRow.id, contractId: contractRow.id })
	);

	expect(result.excerpt).toBe('');
	expect(result.proposedFields).toEqual({ days: [] });
	expect(result.confidence).toBe(1);
});

test.each([
	['not json at all', 'is not valid JSON'],
	[JSON.stringify({ excerpt: 'x' }), 'missing one of'],
	[JSON.stringify({ excerpt: '', confidence: 0.5, proposedFields: {} }), 'not a non-blank string'],
	[JSON.stringify({ excerpt: 'x', confidence: 2, proposedFields: {} }), 'not a number in'],
	[
		JSON.stringify({ excerpt: 'x', confidence: 0.5, confidenceReason: 3, proposedFields: {} }),
		'confidenceReason is not a string'
	],
	[JSON.stringify({ excerpt: 'x', confidence: 0.5, proposedFields: 'nope' }), 'not an object']
])(
	'a malformed model response %s is a loud error, never a best-effort guess',
	async (text, expectedMessage) => {
		const contractRow = await insertCommittedContract();
		cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
		const documentRow = await insertCommittedDocument(contractRow.id);
		runnerSql = connectRunnerDb(runnerDatabaseUrl);

		const badModel: ExtractionModel = {
			async call() {
				return { text };
			}
		};
		await expect(
			processExtractionJob(
				runnerSql,
				badModel,
				baseRequest({ documentId: documentRow.id, contractId: contractRow.id })
			)
		).rejects.toThrow(new RegExp(expectedMessage));
	}
);
