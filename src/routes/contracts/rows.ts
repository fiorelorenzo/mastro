import { resolveRateCard } from '$lib/server/domain/rate-card';

/**
 * One row of the contracts index (#361).
 *
 * `rateInForce` is null when no rate card covers the date, and the page
 * renders that as an explicit badge rather than an empty cell: a contract
 * with no rate card in force cannot price a day at all, which is otherwise
 * discovered only when recording one fails.
 */
export type ContractRow = {
	id: string;
	title: string;
	clientId: string;
	clientLegalName: string;
	status: string;
	startsOn: string;
	endsOn: string | null;
	currency: string;
	requiresPriorApproval: boolean;
	rateInForce: { amount: number; unit: string } | null;
};

/** The shapes this needs off a contract row, so the loader can pass what its
 * own query returns without this module importing the schema. */
export interface ContractSource {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly startsOn: string;
	readonly endsOn: string | null;
	readonly currency: string;
	readonly requiresPriorApproval: boolean;
	readonly client: { readonly id: string; readonly legalName: string };
}

export interface RateCardSource {
	/** Required by `resolveRateCard`'s own `RateCardValidity`. */
	readonly id: string;
	readonly contractId: string;
	readonly validFrom: string;
	readonly validTo: string | null;
	readonly amount: string | number;
	readonly unit: string;
}

/**
 * Builds the index's rows from one contracts query and one rate-cards query.
 *
 * Separated from the loader so the grouping and the in-force resolution are
 * testable without a database: both acceptance criteria worth defending here
 * are properties of this function, not of the queries - that a contract only
 * ever sees its own cards even when several clients' contracts are
 * interleaved, and that no card covering `date` yields null rather than a
 * silently missing value.
 *
 * `resolveRateCard` is the same resolver the contract detail page uses for
 * its own "rate in force" tile, so the index and the detail cannot disagree
 * about which card is current.
 */
export function contractRows(
	contracts: readonly ContractSource[],
	rateCards: readonly RateCardSource[],
	date: string
): ContractRow[] {
	const byContract = new Map<string, RateCardSource[]>();
	for (const card of rateCards) {
		const existing = byContract.get(card.contractId);
		if (existing) existing.push(card);
		else byContract.set(card.contractId, [card]);
	}

	return contracts.map((row) => {
		const inForce = resolveRateCard(byContract.get(row.id) ?? [], date);
		return {
			id: row.id,
			title: row.title,
			clientId: row.client.id,
			clientLegalName: row.client.legalName,
			status: row.status,
			startsOn: row.startsOn,
			endsOn: row.endsOn,
			currency: row.currency,
			requiresPriorApproval: row.requiresPriorApproval,
			// `numeric` comes back from Postgres as a string, and the page
			// formats it through `Intl`, which would render "NaN" for one that
			// slipped through unconverted.
			rateInForce: inForce ? { amount: Number(inForce.amount), unit: inForce.unit } : null
		};
	});
}
