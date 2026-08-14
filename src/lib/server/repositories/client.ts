import { asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { client, clientContact, type NoticeChannel } from '$lib/server/db/schema';

export type ClientContactInput = {
	name: string;
	email: string;
	phone: string | null;
	role: string | null;
	canApprove: boolean;
};

export type ClientInput = {
	legalName: string;
	taxId: string | null;
	vatId: string | null;
	country: string;
	addressLine1: string | null;
	addressLine2: string | null;
	addressCity: string | null;
	addressPostalCode: string | null;
	addressRegion: string | null;
	noticeChannel: NoticeChannel | null;
	// #259: FatturaPA's CodiceDestinatario/PECDestinatario. Both optional —
	// see `client.ts`'s schema comment for why, and
	// `domain/invoice.ts`'s `resolveInvoiceRouting` for how an invoice
	// detail screen turns these into "which of the three cases applies".
	sdiCode: string | null;
	pecAddress: string | null;
	contacts: ClientContactInput[];
};

export async function listClients() {
	return db.query.client.findMany({
		with: { contacts: true },
		orderBy: asc(client.legalName)
	});
}

export async function getClientWithContacts(id: string) {
	return db.query.client.findFirst({
		where: eq(client.id, id),
		with: { contacts: true }
	});
}

/** Looks a client up by its unique tax id — the same key #259 already
 * cites for import matching (`client.ts`'s own schema comment). Used by
 * #86's contract-from-PDF accept dispatcher to find-or-create the client
 * a first-intake contract names, rather than creating a duplicate row
 * every time the same counterparty's next contract is proposed. */
export async function getClientByTaxId(taxId: string, executor: DbExecutor = db) {
	return executor.query.client.findFirst({ where: eq(client.taxId, taxId) });
}

/** `tx`, if given, is used directly instead of opening a new transaction
 * — lets a caller (#86's accept dispatcher) compose this with other
 * writes atomically, the same reason `createApproval` takes one. */
export async function createClient(input: ClientInput, tx?: DbExecutor) {
	const { contacts, ...clientFields } = input;
	const run = async (executor: DbExecutor) => {
		const [row] = await executor.insert(client).values(clientFields).returning();
		if (contacts.length > 0) {
			await executor
				.insert(clientContact)
				.values(contacts.map((contact) => ({ ...contact, clientId: row.id })));
		}
		return row;
	};
	return tx ? run(tx) : db.transaction(run);
}

/** Replaces the client's contacts wholesale rather than diffing them: the
 * edit form has no stable client-side identity for a contact row to diff
 * against, and the table has no history worth preserving row by row. */
export async function updateClient(id: string, input: ClientInput) {
	const { contacts, ...clientFields } = input;
	return db.transaction(async (tx) => {
		const [row] = await tx.update(client).set(clientFields).where(eq(client.id, id)).returning();
		await tx.delete(clientContact).where(eq(clientContact.clientId, id));
		if (contacts.length > 0) {
			await tx
				.insert(clientContact)
				.values(contacts.map((contact) => ({ ...contact, clientId: id })));
		}
		return row;
	});
}
