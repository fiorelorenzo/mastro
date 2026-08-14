import { db, type DbExecutor } from '$lib/server/db';
import { monthRangeForDate } from '$lib/server/domain/dispute-bundle';
import type { DisputeBundle } from '$lib/server/dispute-bundle/types';
import { getApproval } from './approval';
import { listClauseNotes } from './clause-note';
import { getContractWithClient } from './contract';
import { buildRegister } from './register';
import { getWorkUnit, getWorkUnitDocument, getWorkUnitInvoiceLine } from './work-unit';

/**
 * Assembles #214's evidence bundle for `workUnitId` — one query per source,
 * run together, never a second guess at what any of them already returned.
 * `null` only when the day itself does not exist or its contract does not
 * (the same "not found" the day detail page itself already treats as a
 * 404); every field inside a real bundle is allowed to be `null`/empty on
 * its own terms (see `DisputeBundle`'s own doc comment) rather than
 * failing the whole assembly.
 */
export async function buildDisputeBundle(
	workUnitId: string,
	executor: DbExecutor = db
): Promise<DisputeBundle | null> {
	const workUnit = await getWorkUnit(workUnitId, executor);
	if (!workUnit) return null;

	const contract = await getContractWithClient(workUnit.contractId, executor);
	if (!contract) return null;

	const registerRange = monthRangeForDate(workUnit.date);

	const [approval, document, register, clauseNotes, invoiceLineRow] = await Promise.all([
		workUnit.approvalId ? getApproval(workUnit.approvalId, executor) : null,
		getWorkUnitDocument(workUnitId, executor),
		buildRegister(workUnit.contractId, registerRange.from, registerRange.to, executor),
		listClauseNotes(workUnit.contractId, executor),
		workUnit.invoiceLineId ? getWorkUnitInvoiceLine(workUnitId, executor) : null
	]);

	return {
		workUnitId: workUnit.id,
		date: workUnit.date,
		quantity: Number(workUnit.quantity),
		scope: workUnit.scope,
		state: workUnit.state,
		contract: {
			id: contract.id,
			title: contract.title,
			clientName: contract.client.legalName,
			currency: contract.currency,
			templateLanguage: contract.templateLanguage
		},
		approval: approval
			? {
					id: approval.id,
					channel: approval.channel,
					sender: approval.sender,
					receivedAt: approval.receivedAt,
					messageId: approval.messageId,
					excerpt: approval.excerpt
				}
			: null,
		document: document
			? {
					id: document.id,
					hash: document.hash,
					mime: document.mime,
					originalName: document.originalName,
					provenance: document.provenance,
					createdAt: document.createdAt
				}
			: null,
		register: {
			from: registerRange.from,
			to: registerRange.to,
			entry: register.entries.find((entry) => entry.workUnitId === workUnitId) ?? null,
			totalQuantity: register.totalQuantity
		},
		clauseNotes: clauseNotes.map((note) => ({
			id: note.id,
			clauseReference: note.clauseReference,
			verbatimText: note.verbatimText,
			interpretationAdopted: note.interpretationAdopted
		})),
		invoiceLine: invoiceLineRow
			? {
					invoiceId: invoiceLineRow.invoice.id,
					invoiceNumber: invoiceLineRow.invoice.number,
					lineDescription: invoiceLineRow.invoiceLine.description,
					amount: invoiceLineRow.invoiceLine.amount,
					currency: invoiceLineRow.invoice.currency
				}
			: null
	};
}
