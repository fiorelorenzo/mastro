// Read-only half of the import pipeline (#47: "nothing is written until
// the user confirms", extended by #44 and #48). Takes the files the client
// already scanned and expanded (folder walk, zip expansion and `.p7m`
// unwrapping all happen in the browser — see `$lib/import/scan.ts`, #43),
// parses each one, and computes the review the client renders. Never
// inserts, updates or deletes a row: `existingInvoices`, the per-client
// active contract and the day-mapping context are all read here and handed
// to the pure `buildReview`, never mutated.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { db } from '$lib/server/db';
import type { ContractStatus } from '$lib/server/db/schema';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import type { ImportableFile } from '$lib/server/import/adapter';
import type { ClientMatchCandidate } from '$lib/server/import/client-match';
import { accountHolderTaxId } from '$lib/server/import/config';
import type { DayMappingContext } from '$lib/server/import/review';
import { defaultAdapterRegistry } from '$lib/server/import/registry';
import { buildReview } from '$lib/server/import/review';
import { listClients } from '$lib/server/repositories/client';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listInvoicesForDedup } from '$lib/server/repositories/invoice';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listEligibleWorkUnitsForInvoicing } from '$lib/server/repositories/work-unit';
import type { RequestHandler } from './$types';

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** The one contract an imported invoice for `clientId` can be filed
 * against without asking (#44): its sole `active` contract. `null` when
 * there is none or more than one — the client's tax id is enough to prove
 * which invoices are theirs, but nothing on the document says which of
 * several concurrent engagements one belongs to, so `review.ts` leaves
 * that file unimported rather than guessing. */
function resolveActiveContractId(
	contracts: readonly {
		readonly clientId: string;
		readonly id: string;
		readonly status: ContractStatus;
	}[]
): string | null {
	const active = contracts.filter((row) => row.status === 'active');
	return active.length === 1 ? active[0].id : null;
}

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const files: ImportableFile[] = [];
	for (const entry of formData.getAll('file')) {
		if (!(entry instanceof File)) continue;
		files.push({ filename: entry.name, content: new Uint8Array(await entry.arrayBuffer()) });
	}

	const activePeriod = await resolveActiveFiscalPack(db, todayIsoDate());
	if (!activePeriod) {
		return text(m.import_no_active_pack(), { status: 422 });
	}

	const [clientRows, contractRows, existingInvoices] = await Promise.all([
		listClients(),
		listContractsWithClient(),
		listInvoicesForDedup()
	]);

	const contractsByClientId = new Map<string, typeof contractRows>();
	for (const row of contractRows) {
		const list = contractsByClientId.get(row.clientId) ?? [];
		list.push(row);
		contractsByClientId.set(row.clientId, list);
	}

	const clients: ClientMatchCandidate[] = clientRows.map((row) => ({
		id: row.id,
		taxId: row.taxId,
		legalName: row.legalName,
		activeContractId: resolveActiveContractId(contractsByClientId.get(row.id) ?? [])
	}));

	const dayMappingByContractId = new Map<string, DayMappingContext>();
	const resolvedContractIds = clients
		.map((c) => c.activeContractId)
		.filter((id): id is string => id !== null);
	await Promise.all(
		resolvedContractIds.map(async (contractId) => {
			const [rateCards, eligibleDays] = await Promise.all([
				listRateCards(contractId),
				listEligibleWorkUnitsForInvoicing(contractId)
			]);
			dayMappingByContractId.set(contractId, {
				rateCards,
				eligibleDays: eligibleDays.map((row) => ({
					id: row.id,
					date: row.date,
					quantity: Number(row.quantity)
				}))
			});
		})
	);

	const review = buildReview(
		files,
		activePeriod.pack,
		defaultAdapterRegistry,
		accountHolderTaxId,
		clients,
		existingInvoices,
		dayMappingByContractId
	);

	return json(review);
};
