// Writes an accepted clarification (#46/#47's confirm step) — the only
// place in the whole import pipeline that touches the database. Everything
// upstream (`review.ts`) only proposes; nothing reaches the ledger until a
// human calls this, one proposal at a time, per invariant 3.
//
// Deliberately not a call into `repositories/client.ts`'s `createClient`:
// that function also inserts `client_contact` rows from a `contacts` array
// this proposal has none of (an invoice names a legal entity, never a
// person to notify), and composing it with a separate `createContract`
// call would leave two independent transactions — a contract insert
// failing after the client insert already committed leaves an orphan
// client. One transaction, both inserts, is the whole of what this needs.

import { db, type DbExecutor } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ClientProposal, ContractProposal } from './client-match';

export interface ConfirmedProposal {
	readonly clientId: string;
	readonly contractId: string;
}

/**
 * Inserts the client and its contract atomically. `tx`, if given, is used
 * directly instead of opening a new transaction — same convention as
 * `repositories/approval.ts`'s `createApproval`, and for the same reason: a
 * caller confirming several proposals in one request can compose them into
 * one transaction, and a test can compose this with a rollback.
 *
 * Left to the caller: catching a unique-tax-id violation when the proposed
 * client already exists (a race with another import, or with manual client
 * creation, between review and confirm) — see the route handler, which
 * mirrors `routes/clients/new/+page.server.ts`'s handling of the same
 * constraint.
 */
export async function confirmClientContractProposal(
	clientProposal: ClientProposal,
	contractProposal: ContractProposal,
	tx?: DbExecutor
): Promise<ConfirmedProposal> {
	const run = async (executor: DbExecutor): Promise<ConfirmedProposal> => {
		const [clientRow] = await executor.insert(client).values(clientProposal).returning();
		const [contractRow] = await executor
			.insert(contract)
			.values({ ...contractProposal, clientId: clientRow.id })
			.returning();
		return { clientId: clientRow.id, contractId: contractRow.id };
	};
	return tx ? run(tx) : db.transaction(run);
}
