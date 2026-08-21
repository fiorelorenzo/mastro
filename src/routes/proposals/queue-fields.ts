/**
 * Reading a proposal's own `proposedFields` well enough to describe it in
 * the queue, without trusting it.
 *
 * `proposedFields` is untyped JSONB written by an extraction, so every read
 * here is defensive: a row these cannot make sense of shows a generic
 * label, and the queue still opens. That matters more than it sounds —
 * the review queue is one page listing every pending proposal, so one
 * unreadable row throwing would take the whole screen with it.
 *
 * Route-local rather than in `$lib`: nothing else needs these, and they
 * live here for the same reason `proposal-status.ts` does — a sibling
 * module the test suite covers, with the route file left to wiring.
 */
import {
	parseExtractedContract,
	type ExtractedContractFields,
	type ExtractedRateCard
} from '$lib/server/agent/contract-extraction';
import type { ProposalRow } from '$lib/server/repositories/proposal';

/** The `work_unit` shape a day proposal carries. */
export function workUnitFields(
	fields: Record<string, unknown>
): { date: string; quantity: number; scope: string } | null {
	const { date, quantity, scope } = fields;
	if (typeof date !== 'string' || typeof quantity !== 'number' || typeof scope !== 'string') {
		return null;
	}
	return { date, quantity, scope };
}

/**
 * What a queue card shows for a first-intake `'contract'` proposal: the
 * counterparty, the terms, and the rates.
 *
 * Only these three. The parsed candidate also carries the clause flags with
 * their verbatim spans and the client's full postal address, which the
 * review screen needs and a queue card does not, so they stay on the
 * server rather than riding along in every page payload.
 */
export type ProposedContract = {
	clientLegalName: string;
	contract: ExtractedContractFields;
	rateCards: ExtractedRateCard[];
};

/**
 * The same `parseExtractedContract` the review screen and the accept
 * dispatcher run, reused rather than reimplemented so the three cannot
 * disagree about what a proposal says. Its own contract is that it throws
 * on a shape it does not recognise instead of repairing it, which is right
 * for a writer and wrong for a queue: here the throw becomes `null`, the
 * card falls back to a generic label, and the other proposals still
 * render.
 *
 * A contract proposal has no date and no quantity, so before this the
 * queue described it with a day's own template and rendered `— — —`,
 * literally two placeholders and the separator between them.
 */
export function proposedContract(fields: Record<string, unknown>): ProposedContract | null {
	try {
		const candidate = parseExtractedContract(fields);
		return {
			clientLegalName: candidate.client.legalName,
			contract: candidate.contract,
			rateCards: candidate.rateCards
		};
	} catch {
		return null;
	}
}

/**
 * Whether a re-read (Task 5) has rewritten this proposal in place since it
 * was created. `acceptProposal`/`rejectProposal` are the only other
 * writers of a proposal row, and both move it out of `pending` in the same
 * `UPDATE`, so scoping to `status === 'pending'` is what keeps a decided
 * row — whose `updatedAt` necessarily moved when it was decided — from
 * reading as revised. The one-second tolerance exists because `createdAt`
 * and `updatedAt` are both `defaultNow()` columns written by the same
 * `INSERT`: they can differ by a database-clock rounding sliver with no
 * second write at all. One second is comfortably wider than that sliver
 * and comfortably narrower than any real re-read, which happens in a
 * separate request at a different time entirely.
 */
export function proposalRevised(
	row: Pick<ProposalRow, 'status' | 'createdAt' | 'updatedAt'>
): boolean {
	return row.status === 'pending' && row.updatedAt.getTime() - row.createdAt.getTime() > 1000;
}
