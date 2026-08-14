// The I/O `/import/days/analyze` and `/import/days/confirm` both need
// before they can call the pure `buildDayImportReview` (#224): parsing the
// uploaded file, validating a client-supplied column mapping, and reading
// every candidate client/contract, rate card and already-recorded day.
// Kept in one place because both route handlers need it verbatim — the
// confirm endpoint recomputes the same dry run the analyze endpoint just
// showed, against whatever the database looks like right now, rather than
// trusting a review computed a request ago (`persist.ts`'s "the structured
// document wins", applied here to "the structured file wins").
import { db, type DbExecutor } from '$lib/server/db';
import type { WorkUnitState } from '$lib/server/db/schema';
import type { PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import {
	dayImportKey,
	parseImportedDate,
	type DayImportCandidateClient,
	type DayImportCandidateContract,
	type DayImportColumnMapping,
	type DayImportExistingStateByKey
} from './day-import';
import { detectDelimiter, parseCsv } from './formats/day-csv/csv';
import { listClients } from '$lib/server/repositories/client';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listWorkUnitsBetween } from '$lib/server/repositories/work-unit';

function isMappingValue(value: unknown): value is number | null {
	return value === null || typeof value === 'number';
}

/** Loose but real validation of a client-supplied `DayImportColumnMapping`:
 * every one of the six keys must be a number or `null`, not merely "an
 * object" — a malformed `mapping` field is a 400 the caller can return,
 * never a `TypeError` three calls deeper. */
export function isDayImportColumnMapping(value: unknown): value is DayImportColumnMapping {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		isMappingValue(candidate.date) &&
		isMappingValue(candidate.quantity) &&
		isMappingValue(candidate.scope) &&
		isMappingValue(candidate.client) &&
		isMappingValue(candidate.contract) &&
		isMappingValue(candidate.state)
	);
}

export interface ParsedDayImportFile {
	readonly headerRow: readonly string[];
	readonly dataRows: readonly (readonly string[])[];
}

/** Sniffs the delimiter from the file's own header line and parses the
 * whole thing; `null` for a file with no rows at all, so the caller can
 * turn that into its own 422 rather than handing `buildDayImportReview` an
 * empty array and a confusing "0 rows imported" report. */
export function parseDayImportFile(content: string): ParsedDayImportFile | null {
	const firstLineEnd = content.indexOf('\n');
	const headerLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
	const rows = parseCsv(content, detectDelimiter(headerLine));
	if (rows.length === 0) return null;
	const [headerRow, ...dataRows] = rows;
	return { headerRow, dataRows };
}

/** Every client on record, each with only its own `active` contracts —
 * `/day/new`'s own restriction (`loadActiveContracts`), applied here for
 * the same reason: a bulk historical import is never the fast path that
 * wants to file a day against a draft, terminated or expired contract
 * either. `listClients` is the full roster (so a client with literally no
 * contract at all still comes back with an empty `activeContracts`,
 * distinguishing "unknown client" from "known client, nothing active to
 * bill against") and `listContractsWithClient` supplies every contract,
 * active or not; only the `active` ones are kept. */
export async function candidateClientsForDayImport(): Promise<readonly DayImportCandidateClient[]> {
	const [clients, contractsWithClient] = await Promise.all([
		listClients(),
		listContractsWithClient()
	]);
	const activeContractsByClientId = new Map<string, DayImportCandidateContract[]>();
	for (const row of contractsWithClient) {
		if (row.status !== 'active') continue;
		const contracts = activeContractsByClientId.get(row.clientId) ?? [];
		contracts.push({
			id: row.id,
			title: row.title,
			currency: row.currency,
			requiresPriorApproval: row.requiresPriorApproval
		});
		activeContractsByClientId.set(row.clientId, contracts);
	}
	return clients.map((clientRow) => ({
		id: clientRow.id,
		legalName: clientRow.legalName,
		activeContracts: activeContractsByClientId.get(clientRow.id) ?? []
	}));
}

/** Every active contract's own rate cards — enough for `priceWorkUnitOnDate`
 * to preview each valid row's amount, same as `day-mapping.ts`'s
 * `DayMappingContext` already fetches per active contract for the invoice
 * importer's own day-mapping proposal. */
export async function rateCardsForContracts(
	contractIds: Iterable<string>
): Promise<ReadonlyMap<string, readonly PriceableRateCard[]>> {
	return new Map(
		await Promise.all([...contractIds].map(async (id) => [id, await listRateCards(id)] as const))
	);
}

/** Every `${contractId}|${date}` pair, among `activeContractIds`, that
 * already carries a live day (`dayImportKey`'s own key shape) — the range
 * queried is exactly the span `mapping.date`'s column produces once every
 * cell is parsed, so a row far outside the batch's own dates never forces
 * scanning the whole table. `Map()` for a batch with no parseable date at
 * all: nothing to look up, and `listWorkUnitsBetween` has no sensible
 * range to ask for. */
export async function existingStateByKeyForDayImport(
	dataRows: readonly (readonly string[])[],
	mapping: DayImportColumnMapping,
	activeContractIds: ReadonlySet<string>,
	executor: DbExecutor = db
): Promise<DayImportExistingStateByKey> {
	if (mapping.date === null) return new Map();
	const dateColumn = mapping.date;
	const parsedDates = dataRows
		.map((row) => parseImportedDate(row[dateColumn] ?? ''))
		.filter((date): date is string => date !== null);
	if (parsedDates.length === 0) return new Map();

	const minDate = parsedDates.reduce((earliest, date) => (date < earliest ? date : earliest));
	const maxDate = parsedDates.reduce((latest, date) => (date > latest ? date : latest));
	const existingWorkUnits = await listWorkUnitsBetween(minDate, maxDate, executor);

	const byKey = new Map<string, WorkUnitState>();
	for (const row of existingWorkUnits) {
		if (!activeContractIds.has(row.contractId)) continue;
		if (row.state === 'rejected' || row.state === 'revoked') continue;
		byKey.set(dayImportKey(row.contractId, row.date), row.state);
	}
	return byKey;
}
