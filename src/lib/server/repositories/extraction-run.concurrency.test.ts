import { afterAll, expect, test } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { client as pool, db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { client, document, extractionRun, proposal } from '$lib/server/db/schema';
import {
	claimRunForApply,
	createExtractionRun,
	finishRunApplied,
	getExtractionRunByJobId
} from './extraction-run';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
//
// The one test here that cannot roll itself back, and the reason is the
// thing under test. `claimRunForApply` guards a race between two
// processes — the request watching a run and the five-minute scheduler
// tick — and a race needs two connections. Inside a single transaction
// there is no second connection to lose to, so `inRolledBackTransaction`
// would prove the guard works against nobody.
//
// It therefore writes for real and deletes exactly what it wrote,
// scoped to its own ids, so it stays safe on a seeded instance.

const secondary = postgres(env.DATABASE_URL ?? '', { max: 2 });
const other = drizzle(secondary, { schema });

const created: { clientIds: string[]; documentIds: string[] } = { clientIds: [], documentIds: [] };

afterAll(async () => {
	for (const id of created.documentIds) {
		await db.delete(extractionRun).where(eq(extractionRun.documentId, id));
		await db.delete(proposal).where(eq(proposal.documentId, id));
		await db.delete(document).where(eq(document.id, id));
	}
	for (const id of created.clientIds) await db.delete(client).where(eq(client.id, id));
	await secondary.end();
	await pool.end();
});

async function seedExtractedRun() {
	const [clientRow] = await db
		.insert(client)
		.values({ legalName: `Race probe ${crypto.randomUUID()}`, country: 'IT' })
		.returning();
	created.clientIds.push(clientRow.id);

	// Unclaimed, exactly as a contract's own founding PDF is archived.
	const [documentRow] = await db
		.insert(document)
		.values({
			hash: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
			mime: 'application/pdf',
			size: 1,
			originalName: 'race.pdf',
			provenance: 'upload',
			confidential: true,
			contractId: null,
			ownerType: null,
			ownerId: null
		})
		.returning();
	created.documentIds.push(documentRow.id);

	const [proposalRow] = await db
		.insert(proposal)
		.values({
			documentId: documentRow.id,
			contractId: null,
			targetType: 'contract',
			proposedFields: {},
			excerpt: 'race',
			confidence: 0.5
		})
		.returning();

	const jobId = crypto.randomUUID();
	await createExtractionRun({
		jobId,
		documentId: documentRow.id,
		targetType: 'contract',
		enqueuedAt: new Date()
	});
	await db.update(extractionRun).set({ status: 'extracted' }).where(eq(extractionRun.jobId, jobId));

	return { jobId, proposalId: proposalRow.id };
}

test('two drainers race one run and exactly one of them writes it', async () => {
	const { jobId, proposalId } = await seedExtractedRun();

	// A gate rather than a delay: the loser signals immediately before
	// issuing its own claim, and the winner only then commits, so the
	// interleaving under test is reached without timing anything. Should
	// the signal land late, the loser simply finds a run that is already
	// `applied` — a different path to the same single winner, which is
	// why the assertion is on the count and not on which one won.
	const gate = Promise.withResolvers<void>();

	const winner = db.transaction(async (tx) => {
		const claimed = await claimRunForApply(jobId, tx);
		if (!claimed) return 'lost';
		await gate.promise;
		await finishRunApplied(jobId, proposalId, tx);
		return 'won';
	});

	const loser = other.transaction(async (tx) => {
		gate.resolve();
		const claimed = await claimRunForApply(jobId, tx);
		if (!claimed) return 'lost';
		await finishRunApplied(jobId, proposalId, tx);
		return 'won';
	});

	const outcomes = await Promise.all([winner, loser]);

	expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1);
	expect(outcomes.filter((outcome) => outcome === 'lost')).toHaveLength(1);

	const row = await getExtractionRunByJobId(jobId);
	expect(row?.status).toBe('applied');
	expect(row?.proposalId).toBe(proposalId);
});

test('a drainer arriving after the run is applied claims nothing', async () => {
	const { jobId, proposalId } = await seedExtractedRun();

	await db.transaction(async (tx) => {
		expect(await claimRunForApply(jobId, tx)).not.toBeNull();
		await finishRunApplied(jobId, proposalId, tx);
	});

	// The scheduler's tick, arriving five minutes late on a run the page
	// already drained: it must find nothing to do rather than produce a
	// second set of proposals from the one document.
	expect(await claimRunForApply(jobId)).toBeNull();
});
