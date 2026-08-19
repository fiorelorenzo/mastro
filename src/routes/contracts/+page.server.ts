// The contracts index (#361). A contract is what days, invoices, ceilings and
// rate cards all hang off, and until now it had no surface of its own: the
// only way to one was to already know which client it belonged to, so "which
// contracts do I have" was a question the product could not answer.
//
// This is an index, not a second home. The detail page stays at
// `/clients/[id]/contracts/[contractId]`, because a contract genuinely belongs
// to one client, and every row deep-links there so there is exactly one
// canonical detail route.
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listRateCardsForContracts } from '$lib/server/repositories/rate-card';
import { contractRows } from './rows';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const contracts = await listContractsWithClient();

	// One query for every contract's rate cards rather than one per row
	// (`listRateCardsForContracts`, #307). The grouping and the in-force
	// resolution live in `rows.ts`, tested there.
	const rateCards = await listRateCardsForContracts(contracts.map((row) => row.id));

	// Same derivation as the contract detail page's own rate tile.
	const today = new Date().toISOString().slice(0, 10);

	return { rows: contractRows(contracts, rateCards, today) };
};
