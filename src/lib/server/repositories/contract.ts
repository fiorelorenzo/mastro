import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	contract,
	type ContractRenewalType,
	type ContractStatus,
	type ExpensePolicy,
	type InvoicingCadence,
	type PaymentTerms
} from '$lib/server/db/schema';

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
