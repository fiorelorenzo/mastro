import { and, eq, isNotNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { client, clientContact, contract } from '$lib/server/db/schema';

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
