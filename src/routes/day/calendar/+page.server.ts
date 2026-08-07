import { listClients } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listWorkUnitsBetween } from '$lib/server/repositories/work-unit';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { dayCountsTowardAmount, dayCountsTowardDays } from '../work-unit-state';
import { monthRange, startOfMonth } from './month-grid';
import type { PageServerLoad } from './$types';

const ISO_MONTH = /^\d{4}-\d{2}$/;

export const load: PageServerLoad = async ({ url }) => {
	const requestedMonth = url.searchParams.get('month');
	const monthStart = startOfMonth(
		requestedMonth && ISO_MONTH.test(requestedMonth)
			? `${requestedMonth}-01`
			: new Date().toISOString().slice(0, 10)
	);
	const { start, end } = monthRange(monthStart);

	const workUnits = await listWorkUnitsBetween(start, end);
	const contractIds = [...new Set(workUnits.map((row) => row.contractId))];

	const [contracts, clients, rateCardEntries] = await Promise.all([
		listContracts(),
		listClients(),
		Promise.all(contractIds.map(async (id) => [id, await listRateCards(id)] as const))
	]);
	const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
	const clientNameById = new Map(clients.map((client) => [client.id, client.legalName]));
	const rateCardsByContract = new Map(rateCardEntries);

	const entries = workUnits.map((row) => {
		const contract = contractById.get(row.contractId);
		const quantity = Number(row.quantity);
		const amount = priceWorkUnitOnDate(
			{ date: row.date, quantity },
			rateCardsByContract.get(row.contractId) ?? []
		);
		return {
			id: row.id,
			date: row.date,
			state: row.state,
			quantity,
			amount,
			currency: contract?.currency ?? null,
			contractLabel: contract
				? `${clientNameById.get(contract.clientId) ?? contract.clientId} — ${contract.title}`
				: row.contractId
		};
	});

	const entriesByDate = new Map<string, typeof entries>();
	for (const entry of entries) {
		const list = entriesByDate.get(entry.date);
		if (list) list.push(entry);
		else entriesByDate.set(entry.date, [entry]);
	}

	// "Days worked" counts every day that actually happened, billable or
	// not; the amount total only counts what will actually be invoiced —
	// see `dayCountsTowardDays`/`dayCountsTowardAmount` for exactly which
	// states fall on which side. Amounts are grouped by currency rather
	// than assumed uniform: nothing stops two contracts on different
	// currencies both landing days in the same month.
	let totalDays = 0;
	const totalsByCurrency = new Map<string, number>();
	for (const entry of entries) {
		if (dayCountsTowardDays(entry.state)) totalDays += entry.quantity;
		if (dayCountsTowardAmount(entry.state) && entry.amount !== null && entry.currency) {
			totalsByCurrency.set(
				entry.currency,
				(totalsByCurrency.get(entry.currency) ?? 0) + entry.amount
			);
		}
	}

	return { monthStart, entries, entriesByDate, totalDays, totalsByCurrency };
};
