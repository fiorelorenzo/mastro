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
	status: ContractStatus;
};

export async function listContracts(clientId?: string) {
	return db.query.contract.findMany({
		where: clientId ? eq(contract.clientId, clientId) : undefined,
		orderBy: asc(contract.startsOn)
	});
}

/** Contracts with their client, for a picker (`routes/invoices/new`) that
 * needs to show the client's name next to each contract, not just its id
 * (#26). */
export async function listContractsWithClient() {
	return db.query.contract.findMany({
		with: { client: true },
		orderBy: asc(contract.startsOn)
	});
}

export async function getContract(id: string) {
	return db.query.contract.findFirst({ where: eq(contract.id, id) });
}

export async function createContract(input: ContractInput) {
	const [row] = await db.insert(contract).values(input).returning();
	return row;
}

export async function updateContract(id: string, input: ContractInput) {
	const [row] = await db.update(contract).set(input).where(eq(contract.id, id)).returning();
	return row;
}
