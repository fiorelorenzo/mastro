import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
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
	taxId: string;
	vatId: string | null;
	country: string;
	addressLine1: string;
	addressLine2: string | null;
	addressCity: string;
	addressPostalCode: string;
	addressRegion: string | null;
	noticeChannel: NoticeChannel;
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

export async function createClient(input: ClientInput) {
	const { contacts, ...clientFields } = input;
	return db.transaction(async (tx) => {
		const [row] = await tx.insert(client).values(clientFields).returning();
		if (contacts.length > 0) {
			await tx
				.insert(clientContact)
				.values(contacts.map((contact) => ({ ...contact, clientId: row.id })));
		}
		return row;
	});
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
