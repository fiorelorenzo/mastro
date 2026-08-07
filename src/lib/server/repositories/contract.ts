import { asc, eq, isNotNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	contract,
	type ContractRenewalType,
	type ContractStatus,
	type ContractTemplateLanguage,
	type DocumentProvenance,
	type ExpensePolicy,
	type InvoicingCadence,
	type PaymentTerms
} from '$lib/server/db/schema';
import { storeDocument } from './document';

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

export async function getContract(id: string) {
	return db.query.contract.findFirst({ where: eq(contract.id, id) });
}

export async function getContractWithClient(id: string) {
	return db.query.contract.findFirst({ where: eq(contract.id, id), with: { client: true } });
}

export async function createContract(input: ContractInput) {
	const [row] = await db.insert(contract).values(input).returning();
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

export type HostedExtractionConsentInput = {
	bytes: Uint8Array;
	mime: string;
	originalName: string;
	provenance: DocumentProvenance;
	confidential: boolean;
};

/**
 * Archives `input` as evidence that this contract's client consented in
 * writing to route this contract's documents to a named hosted extraction
 * provider (#81, #82), and points the contract at it — the only way
 * `contract.hostedExtractionConsentDocumentId` is ever set. The document
 * is owned by the contract directly (`ownerType: 'contract'`), the same
 * evidentiary shape `attachExpenseReceipt` gives a receipt and
 * `createApproval` gives an approval's proof; the accompanying custom
 * migration's trigger rejects the update below if the two ever disagree.
 *
 * The ACP runner never calls this: it has no write grant to. This is the
 * human side of #82's boundary — the runner only ever reads what this
 * writes.
 */
export async function setHostedExtractionConsentDocument(
	contractId: string,
	input: HostedExtractionConsentInput,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const documentRow = await storeDocument(
			{ ...input, contractId, ownerType: 'contract', ownerId: contractId },
			executor
		);
		const [row] = await executor
			.update(contract)
			.set({ hostedExtractionConsentDocumentId: documentRow.id })
			.where(eq(contract.id, contractId))
			.returning();
		return row;
	};
	return tx ? run(tx) : db.transaction((innerTx) => run(innerTx));
}

/** Reverts a contract to local-only routing (#81's default) by clearing
 * the consent link. Never deletes the archived document itself — it stays
 * as a historical record of what was once on file, the same way a
 * rejected proposal stays a row rather than being removed (invariant 4:
 * never keep only the extracted fact, and never discard the evidence
 * either once it exists). */
export async function revokeHostedExtractionConsent(contractId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.update(contract)
		.set({ hostedExtractionConsentDocumentId: null })
		.where(eq(contract.id, contractId))
		.returning();
	return row;
}
