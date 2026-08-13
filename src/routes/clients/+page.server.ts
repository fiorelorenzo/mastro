// The client list (#242): "who owes me and how exposed am I to them" —
// each client's own exposure (`fiscal/client-exposure.ts`) alongside the
// identity columns the list already carried. A client with no contract on
// file (and so, transitively, no invoice — every invoice belongs to a
// contract) gets no exposure figures at all: `hasContract` is what the
// page reads to render a designed explanation there instead of a row of
// zeros that would read as "paid in full" rather than "not started yet".
import { listClients } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { emptyClientExposure, listClientExposures } from '$lib/server/fiscal/client-exposure';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = new Date().toISOString().slice(0, 10);

	const [clients, exposures, contracts] = await Promise.all([
		listClients(),
		listClientExposures(today),
		listContracts()
	]);

	const clientIdsWithContracts = new Set(contracts.map((row) => row.clientId));

	return {
		clients: clients.map((clientRow) => ({
			...clientRow,
			hasContract: clientIdsWithContracts.has(clientRow.id),
			exposure: exposures.get(clientRow.id) ?? emptyClientExposure(clientRow.id)
		}))
	};
};
