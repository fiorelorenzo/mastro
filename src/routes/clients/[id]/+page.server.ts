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
import { clientInvoicingGaps } from '$lib/server/fiscal/client-invoicing-gaps';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { db } from '$lib/server/db';
import { listContracts } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, m.client_not_found());

	const today = new Date().toISOString().slice(0, 10);

	const [contracts, exposures, resolvedPack] = await Promise.all([
		listContracts(params.id),
		listClientExposures(today),
		// Today's pack, unlike the invoice screen's "the pack on the
		// invoice's own issue date": this is a question about what this
		// client still needs from here on, not about a document already
		// written.
		resolveActiveFiscalPack(db, today)
	]);

	// Migration 0056: a client needs a legal name and a country, so a row
	// can legitimately be incomplete. Saying so here, in the same shape
	// `practice_profile` uses for "not configured yet", is the difference
	// between an empty field and a fact nobody noticed was missing.
	const invoicingGaps = resolvedPack ? clientInvoicingGaps(client, resolvedPack.pack) : [];

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
		invoicingGaps,
		crumbs
	};
};
