import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { client, clientContact, contract, document, inboundThread } from '$lib/server/db/schema';
import { claimDocumentForContract } from '$lib/server/repositories/document';

/**
 * Which contract an inbound message belongs to, worked out from its sender
 * (#380).
 *
 * Watching a whole mailbox means attribution can no longer come from the
 * folder a message was filed under, so it comes from who sent it: an address
 * that matches a client contact, where that client has exactly one active
 * contract, attributes the message to it.
 *
 * Deliberately conservative. Two contracts on the same client is a real
 * shape - a retainer plus a project - and picking one of them would be a
 * guess presented as a fact, which is the thing this product refuses to do.
 * So an ambiguous match resolves to null, the message is archived
 * unattributed, and a human decides. Same for an address nobody knows.
 *
 * Only active contracts are candidates: a terminated contract is not where
 * this month's mail belongs, and a draft one cannot take a day anyway.
 */
export async function attributeBySender(
	senderEmail: string | null,
	executor: DbExecutor = db
): Promise<{ contractId: string; clientId: string } | null> {
	const address = normaliseAddress(senderEmail);
	if (!address) return null;

	const rows = await executor
		.select({ contractId: contract.id, clientId: client.id })
		.from(clientContact)
		.innerJoin(client, eq(clientContact.clientId, client.id))
		.innerJoin(contract, eq(contract.clientId, client.id))
		.where(and(eq(clientContact.email, address), eq(contract.status, 'active')));

	// Exactly one, or nothing. Several contracts, or one contract reachable
	// through several contacts of the same client, both land here; the second
	// is deduplicated first so a client with two contacts on one contract is
	// not mistaken for an ambiguity.
	const distinct = new Map(rows.map((row) => [row.contractId, row]));
	if (distinct.size !== 1) return null;
	return [...distinct.values()][0];
}

/**
 * The address out of a `From` header, lowercased.
 *
 * `From` is `Name <addr@example.com>` far more often than a bare address, and
 * IMAP envelopes hand back either. Comparison is case-insensitive because the
 * domain half is defined to be, and because a contact typed by hand in the
 * client form is not going to match a machine-generated envelope otherwise.
 */
export function normaliseAddress(raw: string | null): string | null {
	if (!raw) return null;
	const angled = raw.match(/<([^>]+)>/);
	const address = (angled ? angled[1] : raw).trim().toLowerCase();
	return address.includes('@') ? address : null;
}

/**
 * Every address the ledger already knows, for the cheap pre-filter that
 * decides what is worth extracting.
 *
 * Read once per poll rather than queried per message: a mailbox pass looks
 * at every new message, and this is a small table.
 */
export async function knownSenderAddresses(executor: DbExecutor = db): Promise<Set<string>> {
	const rows = await executor
		.select({ email: clientContact.email })
		.from(clientContact)
		.where(isNotNull(clientContact.email));
	return new Set(rows.map((row) => row.email.trim().toLowerCase()));
}

/**
 * Re-decides attribution for messages archived under an unknown sender,
 * now that the contacts may have changed (#388).
 *
 * Two facts make this necessary rather than a nicety. `skip_reason` is
 * written once, at archive time, and the extraction drain filters on it
 * being null, so a message archived before its sender was a contact stays
 * excluded for good unless something revisits it. And the UID cursor has
 * moved past it, so no future poll will offer it again: the message is on
 * disk, kept exactly as invariant 4 promises, and unreachable.
 *
 * What it does not do is guess. A row is only cleared when
 * `attributeBySender` resolves its address to exactly one active contract,
 * which is the same conservative rule a first-time arrival gets. An address
 * matching a client with two active contracts stays unknown, because
 * picking one would be a guess presented as a fact.
 *
 * Bounded by the addresses the ledger knows rather than by scanning every
 * archived row: the join below only reaches rows whose `sender_address` is
 * one of them, so an instance with 20,000 refused newsletters does no work
 * for them. A row archived before `sender_address` existed has none and is
 * invisible here until the backfill gives it one.
 *
 * Returns how many rows became readable, for a poll to report.
 */
export async function reattributeKnownSenders(executor: DbExecutor = db): Promise<number> {
	const candidates = await executor
		.select({
			id: inboundThread.id,
			documentId: inboundThread.documentId,
			senderAddress: inboundThread.senderAddress,
			documentContractId: document.contractId
		})
		.from(inboundThread)
		.innerJoin(clientContact, eq(clientContact.email, inboundThread.senderAddress))
		.leftJoin(document, eq(document.id, inboundThread.documentId))
		.where(
			and(
				eq(inboundThread.archived, true),
				eq(inboundThread.skipReason, 'sender_unknown'),
				isNotNull(inboundThread.senderAddress)
			)
		);

	// One resolution per distinct address, not per row: a contact who wrote
	// forty times is one question about who they are.
	const resolved = new Map<string, string | null>();
	let recovered = 0;
	for (const row of candidates) {
		const address = row.senderAddress;
		if (!address) continue;
		if (!resolved.has(address)) {
			resolved.set(address, (await attributeBySender(address, executor))?.contractId ?? null);
		}
		const contractId = resolved.get(address) ?? null;
		if (!contractId) continue;

		// A document already claimed by a *different* contract is left alone,
		// and so is its thread: a claimed document is evidence somebody
		// already decided what it belongs to, and a sender match is not
		// grounds to overrule that. `document_forbid_retrofit` would refuse
		// the re-point anyway, so this check is not what makes that safe -
		// it only avoids opening a savepoint that is certain to be rolled
		// back, on every row, on every pass. The catch below is what
		// actually keeps one refused row from stopping the others, and it is
		// the fix that mattered: measured against real data, the pass hit
		// the retrofit guard on one already-claimed row, threw, and
		// recovered *nothing* - two perfectly recoverable rows left behind.
		if (row.documentContractId !== null && row.documentContractId !== contractId) continue;

		// A document already claimed by the same contract needs no claim,
		// only the thread moved. Worth stating because the retrofit guard
		// does tolerate that no-op update, so the `=== null` condition below
		// is a deliberate narrowing rather than a requirement.

		// Otherwise the thread row and its archived document move together,
		// or neither does. Clearing `skip_reason` without claiming the
		// document would hand extraction a message whose bytes belong to
		// nobody, which is the state #393 is about; claiming the document
		// without clearing the reason would leave it excluded anyway.
		try {
			await executor.transaction(async (tx) => {
				await tx
					.update(inboundThread)
					.set({ contractId, skipReason: null })
					.where(eq(inboundThread.id, row.id));
				if (row.documentId && row.documentContractId === null) {
					await claimDocumentForContract(row.documentId, contractId, tx);
				}
			});
			recovered += 1;
		} catch {
			// One row that cannot move must not stop the rest, the same shape
			// `publishAllPending` and the alert engine already use. There is
			// deliberately nothing to record here: the row keeps its
			// `sender_unknown`, so it is still listed as an unclaimed address
			// on `/mail` and still a candidate on the next pass, which is a
			// truer report than a log line nobody reads.
			continue;
		}
	}
	return recovered;
}

/**
 * Which contract a message I sent belongs to, worked out from who I sent it
 * to (#409).
 *
 * The mirror image of {@link attributeBySender}, and deliberately the same
 * rule rather than a looser one: for inbound mail the counterparty is the
 * sender, for outbound it is the recipient, and in both cases exactly one
 * active contract has to be reachable or the answer is null and a human
 * decides. `To` and `Cc` are one list here - a confirmation copied to a
 * second address at the same client is the same confirmation.
 *
 * Ambiguity is the case worth stating. A message addressed to contacts of
 * two different clients, or to a client with two active contracts, resolves
 * to null: picking one would be a guess presented as a fact, and this is
 * exactly where that would be least visible, since nobody reviews their own
 * sent mail.
 */
export async function attributeByRecipients(
	addresses: readonly (string | null)[],
	executor: DbExecutor = db
): Promise<{ contractId: string; clientId: string } | null> {
	const normalised = [
		...new Set(
			addresses.map((address) => normaliseAddress(address)).filter((a): a is string => a !== null)
		)
	];
	if (normalised.length === 0) return null;

	const rows = await executor
		.select({ contractId: contract.id, clientId: client.id })
		.from(clientContact)
		.innerJoin(client, eq(clientContact.clientId, client.id))
		.innerJoin(contract, eq(contract.clientId, client.id))
		.where(and(inArray(clientContact.email, normalised), eq(contract.status, 'active')));

	const distinct = new Map(rows.map((row) => [row.contractId, row]));
	if (distinct.size !== 1) return null;
	return [...distinct.values()][0];
}
