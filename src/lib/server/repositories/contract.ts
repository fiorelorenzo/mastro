import { asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	client,
	contract,
	type ContractRenewalType,
	type ContractStatus,
	type ContractTemplateLanguage,
	type ExpensePolicy,
	type InvoicingCadence,
	type PaymentTerms
} from '$lib/server/db/schema';
import { listDocumentsForOwner } from './document';

/** The shape `getContractWithClient`/`getContractsWithClient` return: a
 * contract row with its client eagerly joined, for any screen that shows
 * the client's name next to the contract rather than its id. */
export type ContractWithClient = typeof contract.$inferSelect & {
	client: typeof client.$inferSelect;
};

export type ContractInput = {
	clientId: string;
	title: string;
	signedDocumentReference: string | null;
	startsOn: string;
	endsOn: string | null;
	renewalType: ContractRenewalType;
	renewalNoticeDays: number | null;
	terminationNoticeDays: number;
	paymentTerms: PaymentTerms;
	invoicingCadence: InvoicingCadence;
	currency: string;
	taxTreatment: string;
	requiresPriorApproval: boolean;
	// The language every email_template renders in for this contract
	// (#69) — a property of the counterparty, not of whoever is filling in
	// this form.
	templateLanguage: ContractTemplateLanguage;
	expensePolicy: ExpensePolicy;
	requiresExpensePreAuthorisation: boolean;
	status: ContractStatus;
};

export async function listContracts(clientId?: string) {
	return db.query.contract.findMany({
		where: clientId ? eq(contract.clientId, clientId) : undefined,
		orderBy: asc(contract.startsOn)
	});
}

/** Contracts with their client, for any screen that shows the client's
 * name next to a contract rather than its id: the invoice picker (#26) and
 * the mail hub (#71, #72) both read this one query. */
export async function listContractsWithClient() {
	return db.query.contract.findMany({
		with: { client: true },
		orderBy: asc(contract.startsOn)
	});
}

/** Every contract currently mapped to an inbound mail folder (#84) —
 * `mail/poll.ts`'s own candidate list for one poll pass. `isNotNull`
 * rather than a truthy check in application code: `mail_folder` is
 * never an empty string (`contract_mail_folder_not_blank`, the custom
 * migration), so this is the same "not polled" test the database
 * itself enforces. Takes `executor`, unlike this file's other reads,
 * because `mail/poll.ts` composes it with the rest of one poll pass —
 * the same reason `repositories/document-mirror.ts`'s `listUnmirrored
 * Documents` does. */
export async function listContractsWithMailFolder(executor: DbExecutor = db) {
	return executor
		.select({ id: contract.id, mailFolder: contract.mailFolder })
		.from(contract)
		.where(isNotNull(contract.mailFolder));
}

export async function getContract(id: string, executor: DbExecutor = db) {
	return executor.query.contract.findFirst({ where: eq(contract.id, id) });
}

export async function getContractWithClient(id: string, executor: DbExecutor = db) {
	return executor.query.contract.findFirst({ where: eq(contract.id, id), with: { client: true } });
}

/** Batched `getContractWithClient` (#307): every contract in `ids`, with
 * its client, in one query — the review queue's loaders collect the
 * distinct contract ids across a page of proposals and build an
 * `id -> contract` map from this instead of awaiting one query per row.
 * Empty input skips the round trip rather than sending `WHERE id IN ()`,
 * which Postgres rejects. */
export async function getContractsWithClient(ids: readonly string[], executor: DbExecutor = db) {
	if (ids.length === 0) return [];
	return executor.query.contract.findMany({
		where: inArray(contract.id, ids),
		with: { client: true }
	});
}

/** Every document still owned by the contract itself rather than by one
 *  of its approvals, expenses or invoices — raw inbound mail archived by
 *  the poller (`inbound-thread.ts`'s own `ownerType: 'contract'`
 *  comment) that has not yet become anything more specific, plus the
 *  consent-era documents #196 left in place when the hosted-extraction
 *  gate they were archived under came out. Nothing re-points these
 *  except the flows that create an approval, an expense receipt or an
 *  imported invoice, so this is the one place they stay reachable
 *  (#215's "anywhere else `listDocumentsForOwner` can answer"). */
export async function getContractDocuments(id: string, executor: DbExecutor = db) {
	return listDocumentsForOwner('contract', id, executor);
}

/** `executor`, if given, is used directly instead of the pool — lets a
 * caller (#86's accept dispatcher) compose this with other writes
 * atomically, the same reason `createApproval` takes one. */
export async function createContract(input: ContractInput, executor: DbExecutor = db) {
	const [row] = await executor.insert(contract).values(input).returning();
	return row;
}

export async function updateContract(id: string, input: ContractInput) {
	const [row] = await db.update(contract).set(input).where(eq(contract.id, id)).returning();
	return row;
}

/** #72's per-contract auto-send flag, set independently of the rest of
 * the contract — a mail concern, not a domain one, so it gets its own
 * narrow setter rather than joining `ContractInput`. */
export async function setContractAutoSendMail(id: string, autoSendMail: boolean) {
	const [row] = await db
		.update(contract)
		.set({ autoSendMail })
		.where(eq(contract.id, id))
		.returning();
	return row;
}

/** #69's per-contract template language, set independently of the rest of
 * the contract from the mail hub — the one screen that can act on it today,
 * pending a full contract create/edit form. Mirrors
 * `setContractAutoSendMail`'s narrow-setter shape for the same reason: a
 * property that already exists on `ContractInput` but has, so far, exactly
 * one place in the product that lets a human change it. */
export async function setContractTemplateLanguage(
	id: string,
	templateLanguage: ContractTemplateLanguage
) {
	const [row] = await db
		.update(contract)
		.set({ templateLanguage })
		.where(eq(contract.id, id))
		.returning();
	return row;
}

/** #84's per-contract inbound mail folder/label, set independently of
 * the rest of the contract from the mail hub — mirrors `setContract
 * AutoSendMail`'s and `setContractTemplateLanguage`'s narrow-setter
 * shape for the same reason. `null` clears the mapping (stops polling
 * that contract without deleting any history already handed off for
 * it); the `contract_mail_folder_key` partial unique index (custom
 * migration) is the actual guarantee against two contracts claiming the
 * same folder — this function does not pre-check it, the same way
 * `createContract` does not pre-check any of its own database
 * constraints, so a caller has to handle the constraint violation either
 * way. */
export async function setContractMailFolder(id: string, mailFolder: string | null) {
	const [row] = await db
		.update(contract)
		.set({ mailFolder })
		.where(eq(contract.id, id))
		.returning();
	return row;
}

/**
 * The contract's own status, set on its own (#377) rather than through
 * `updateContract`'s whole-contract input.
 *
 * Activating is the one status change that has a shortcut, because it is the
 * one that unblocks work: `/day/new` offers active contracts only, the day
 * import skips the rest, and both contract alerts query for active. Sending
 * a person through a twenty-field editor to flip that is what made "there
 * is no way to change the status" a reasonable thing to conclude.
 *
 * Takes the status rather than hard-coding `'active'` so the same action can
 * carry the other transitions if they ever earn a shortcut too; the editor
 * keeps the full select either way. Takes an `executor` for the same reason
 * `listContractsWithMailFolder` does - here so a test can watch the write
 * inside a transaction it rolls back, which is what pins down that it
 * touches one contract and not the table.
 */
export async function setContractStatus(
	id: string,
	status: ContractStatus,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(contract)
		.set({ status })
		.where(eq(contract.id, id))
		.returning();
	return row ?? null;
}
