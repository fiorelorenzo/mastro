// The client detail page (#242): identity and contacts stay, but the
// client's own exposure (`fiscal/client-exposure.ts`, the same module the
// list reads) now leads, and each contract carries its own active rate
// card — `resolveRateCard` against today, never a second pricing lookup —
// as its "value".
import { error } from '@sveltejs/kit';
import { clientsCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { emptyClientExposure, listClientExposures } from '$lib/server/fiscal/client-exposure';
import { resolveRateCard } from '$lib/server/domain/rate-card';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, m.client_not_found());

	const today = new Date().toISOString().slice(0, 10);

	const [contracts, exposures] = await Promise.all([
		listContracts(params.id),
		listClientExposures(today)
	]);

	const rateCardsByContract = await Promise.all(
		contracts.map((contractRow) => listRateCards(contractRow.id))
	);
	const contractsWithValue = contracts.map((contractRow, index) => ({
		...contractRow,
		activeRateCard: resolveRateCard(rateCardsByContract[index], today)
	}));

	const crumbs = clientsCrumbs();
	return {
		client,
		contracts: contractsWithValue,
		exposure: exposures.get(client.id) ?? emptyClientExposure(client.id),
		hasContract: contracts.length > 0,
		crumbs
	};
};
