import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { document, extractionRun, proposal } from '$lib/server/db/schema';
import {
	appendRunEvents,
	claimRunForApply,
	createExtractionRun,
	failRun,
	finishRunApplied,
	getExtractionRunByJobId,
	listRunEvents,
	markRunExtracted,
	markRunRunning
} from './extraction-run';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/proposal.test.ts`. No filesystem side effects here — unlike
// `proposal.test.ts`, nothing under test reads or writes document bytes,
// only the `document` row an `extraction_run` foreign keys against, so no
// throwaway blob-store directory is needed.

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An unclaimed document (#86: no contract, no owner) — the shape a
 * first-intake contract PDF is archived under, and the cheapest fixture
 * an `extraction_run.document_id` foreign key can point at. */
async function insertDocument(tx: Tx) {
	const [row] = await tx
		.insert(document)
		.values({
			hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
			mime: 'application/pdf',
			size: 10,
			originalName: 'contract.pdf',
			provenance: 'upload' as const,
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		})
		.returning();
	return row;
}

/** A `'contract'` proposal against `documentId` — the target type whose
 * `contract_id` is allowed to stay null (#86), so this needs no client or
 * contract fixture of its own, only the document it reads from. Stands in
 * for whatever `finishRunApplied`'s caller actually produced. */
async function insertProposal(tx: Tx, documentId: string) {
	const [row] = await tx
		.insert(proposal)
		.values({
			documentId,
			contractId: null,
			targetType: 'contract' as const,
			proposedFields: { legalName: 'Test Client' },
			excerpt: 'Test excerpt from the source document.',
			confidence: 0.9
		})
		.returning();
	return row;
}

test('lifecycle: queued -> running -> extracted -> applied', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		const enqueuedAt = new Date('2026-08-15T09:57:00Z');

		const created = await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt },
			tx
		);
		expect(created.status).toBe('queued');
		expect(created.startedAt).toBeNull();
		expect(created.finishedAt).toBeNull();
		expect(created.enqueuedAt.toISOString()).toBe(enqueuedAt.toISOString());

		const startedAt = new Date('2026-08-15T09:57:05Z');
		await markRunRunning(jobId, startedAt, tx);
		const running = await getExtractionRunByJobId(jobId, tx);
		expect(running?.status).toBe('running');
		expect(running?.startedAt?.toISOString()).toBe(startedAt.toISOString());

		await markRunExtracted(jobId, tx);
		const extracted = await getExtractionRunByJobId(jobId, tx);
		expect(extracted?.status).toBe('extracted');
		expect(extracted?.finishedAt).toBeNull();

		const proposalRow = await insertProposal(tx, documentRow.id);
		const claimedId = await claimRunForApply(jobId, tx);
		expect(claimedId).toBe(created.id);

		await finishRunApplied(jobId, proposalRow.id, tx);
		const applied = await getExtractionRunByJobId(jobId, tx);
		expect(applied?.status).toBe('applied');
		expect(applied?.proposalId).toBe(proposalRow.id);
		expect(applied?.finishedAt).not.toBeNull();
		expect(applied?.error).toBeNull();
	});
});

test('markRunRunning is a no-op once the run has already left queued', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		const firstStartedAt = new Date('2026-08-15T09:57:05Z');
		await markRunRunning(jobId, firstStartedAt, tx);
		await markRunExtracted(jobId, tx);

		// A late caller — the scheduler catching up on a run someone already
		// watched live — must not reset `started_at` or revert the status.
		await markRunRunning(jobId, new Date('2026-08-15T10:00:00Z'), tx);

		const row = await getExtractionRunByJobId(jobId, tx);
		expect(row?.status).toBe('extracted');
		expect(row?.startedAt?.toISOString()).toBe(firstStartedAt.toISOString());
	});
});

test('claimRunForApply returns the run id once, then null on a second call for the same job', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		const created = await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);
		await markRunExtracted(jobId, tx);

		const proposalRow = await insertProposal(tx, documentRow.id);
		const first = await claimRunForApply(jobId, tx);
		expect(first).toBe(created.id);

		await finishRunApplied(jobId, proposalRow.id, tx);

		// The second drainer (design doc: the scheduler tick behind the
		// watching request) reaches the same job after the first already won
		// and committed it `applied` — its own claim now matches nothing.
		const second = await claimRunForApply(jobId, tx);
		expect(second).toBeNull();
	});
});

test('failRun sets the error, and the CHECK rejects a failed row with a null error', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		await failRun(
			jobId,
			'write_refused',
			'client.taxId: Invalid input: expected string, received null',
			tx
		);
		const row = await getExtractionRunByJobId(jobId, tx);
		expect(row?.status).toBe('failed');
		expect(row?.error).toBe('client.taxId: Invalid input: expected string, received null');
		expect(row?.failureKind).toBe('write_refused');
		expect(row?.finishedAt).not.toBeNull();

		expect(
			await rejection(
				() => tx.update(extractionRun).set({ error: null }).where(eq(extractionRun.jobId, jobId)),
				tx
			)
		).toMatchObject({ code: '23514', constraint_name: 'extraction_run_error_iff_failed' });

		// A kind describes a failure and nothing else: it may not survive a
		// run being moved back out of `failed`.
		expect(
			await rejection(
				() =>
					tx
						.update(extractionRun)
						.set({ status: 'extracted', error: null })
						.where(eq(extractionRun.jobId, jobId)),
				tx
			)
		).toMatchObject({
			code: '23514',
			constraint_name: 'extraction_run_failure_kind_only_when_failed'
		});
	});
});

test('appendRunEvents is idempotent per (run_id, seq)', async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		const run = await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		const line = {
			seq: 1,
			at: new Date('2026-08-15T09:57:10Z'),
			kind: 'message',
			payload: 'Reading the contract PDF...'
		};
		// Same line twice: a reconnecting SSE reader replaying a line it
		// already persisted (repository doc comment on `appendRunEvents`).
		await appendRunEvents(run.id, [line], tx);
		await appendRunEvents(run.id, [line], tx);

		const events = await listRunEvents(run.id, tx);
		expect(events).toHaveLength(1);
		expect(events[0].payload).toBe('Reading the contract PDF...');
	});
});

test("listRunEvents returns a run's transcript ordered by seq", async () => {
	await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertDocument(tx);
		const jobId = crypto.randomUUID();
		const run = await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		// Appended out of order, the way updates could arrive out of write
		// order across two separate `appendRunEvents` calls (each event still
		// carries its own `seq` from the runner's own count, not insertion
		// order).
		await appendRunEvents(
			run.id,
			[
				{ seq: 2, at: new Date('2026-08-15T09:57:11Z'), kind: 'thought', payload: 'second' },
				{ seq: 0, at: new Date('2026-08-15T09:57:09Z'), kind: 'plan', payload: 'zeroth' }
			],
			tx
		);
		await appendRunEvents(
			run.id,
			[{ seq: 1, at: new Date('2026-08-15T09:57:10Z'), kind: 'message', payload: 'first' }],
			tx
		);

		const events = await listRunEvents(run.id, tx);
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
		expect(events.map((e) => e.payload)).toEqual(['zeroth', 'first', 'second']);
	});
});
