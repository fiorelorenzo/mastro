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

/** `executor`, when given, lets a caller compose this read with other
 * writes inside its own transaction (#86's contract-review accept
 * dispatcher, resolving a linked client's current row before applying any
 * selected updates) rather than always reading through the pool. */
export async function getClientWithContacts(id: string, executor: DbExecutor = db) {
	return executor.query.client.findFirst({
		where: eq(client.id, id),
		with: { contacts: true }
	});
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
export async function updateClient(id: string, input: ClientInput, tx?: DbExecutor) {
	const { contacts, ...clientFields } = input;
	const run = async (executor: DbExecutor) => {
		const [row] = await executor
			.update(client)
			.set(clientFields)
			.where(eq(client.id, id))
			.returning();
		await executor.delete(clientContact).where(eq(clientContact.clientId, id));
		if (contacts.length > 0) {
			await executor
				.insert(clientContact)
				.values(contacts.map((contact) => ({ ...contact, clientId: id })));
		}
		return row;
	};
	return tx ? run(tx) : db.transaction(run);
}
