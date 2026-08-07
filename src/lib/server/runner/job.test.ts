import { afterAll, afterEach, expect, test } from 'vitest';
import { env } from '$env/dynamic/private';
import { client as pool } from '$lib/server/db';
import { connectRunnerDb, type RunnerDb } from './db.ts';
import { HostedExtractionRefused } from './errors.ts';
import { processExtractionJob, type ExtractionModels } from './job.ts';
import type { ExtractionModel } from './model.ts';
import type { ExtractionRequest } from './types.ts';
import {
	deleteCommittedContract,
	insertCommittedContract,
	insertCommittedDocument
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

	const models: ExtractionModels = { local: NEVER_CALL, hosted: NEVER_CALL };
	await expect(
		processExtractionJob(
			runnerSql,
			models,
			baseRequest({ documentId: documentOfA.id, contractId: contractB.id })
		)
	).rejects.toThrow(/belongs to contract/);
});

test('a document id the runner cannot read at all is rejected', async () => {
	runnerSql = connectRunnerDb(runnerDatabaseUrl);
	const models: ExtractionModels = { local: NEVER_CALL, hosted: NEVER_CALL };
	await expect(
		processExtractionJob(
			runnerSql,
			models,
			baseRequest({ documentId: crypto.randomUUID(), contractId: crypto.randomUUID() })
		)
	).rejects.toThrow(/does not exist/);
});

test('hosted extraction on a contract with no consent on file never reaches the hosted model', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	// The strongest available proof that the hosted path was never
	// reached: patch the real global `fetch` to throw, so *any* code that
	// tried to make a network call — inside this model double, or inside
	// a real implementation that used `fetch` instead of spawning a
	// subprocess — would fail the test, not silently succeed.
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		throw new Error('network reached: the hosted model must never be invoked here');
	}) as typeof fetch;

	const hostedModelThatWouldReachTheNetwork: ExtractionModel = {
		async call() {
			await fetch('https://example.invalid/should-never-be-reached');
			throw new Error('unreachable');
		}
	};

	try {
		await expect(
			processExtractionJob(
				runnerSql,
				{ local: NEVER_CALL, hosted: hostedModelThatWouldReachTheNetwork },
				baseRequest({
					documentId: documentRow.id,
					contractId: contractRow.id,
					requestedProvider: 'hosted'
				})
			)
		).rejects.toThrow(HostedExtractionRefused);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('a successful local call returns a ProposalCandidate shaped from the model response', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const localModel: ExtractionModel = {
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
		{ local: localModel, hosted: NEVER_CALL },
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

test.each([
	['not json at all', 'is not valid JSON'],
	[JSON.stringify({ excerpt: 'x' }), 'missing one of'],
	[JSON.stringify({ excerpt: '', confidence: 0.5, proposedFields: {} }), 'not a non-blank string'],
	[JSON.stringify({ excerpt: 'x', confidence: 2, proposedFields: {} }), 'not a number in'],
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
				{ local: badModel, hosted: NEVER_CALL },
				baseRequest({ documentId: documentRow.id, contractId: contractRow.id })
			)
		).rejects.toThrow(new RegExp(expectedMessage));
	}
);
