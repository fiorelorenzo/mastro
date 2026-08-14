// The day importer's dry run (#224): given the rows a CSV or spreadsheet
// export parsed to and which column carries which field, works out which
// rows are ready to become a `work_unit` — against which contract, priced
// against which rate card, in which state — and which are rejected, and
// why, without writing anything. Pure — no database access, the candidate
// clients/contracts, existing days and rate cards are all read by the
// route handler and handed in — so it is tested the same way `review.ts`
// is for the invoice importer, which this mirrors: a dry-run report over
// per-row outcomes, one bad row never excluding the rest of the file.
//
// "The right contract" is resolved the same way `/day/new` restricts
// itself (`routes/day/new/+page.server.ts`'s `loadActiveContracts`): only
// a client's `active` contracts are ever a target, an explicit contract
// column disambiguates a client with more than one, and no contract at
// all disambiguates one with exactly one. "The right rate" is never
// written — `work_unit` carries no price column, a contract's rate card
// prices a day at invoicing time — so it is only ever a preview here,
// through the same `priceWorkUnitOnDate` the month calendar already
// prices a day with, unpriced (`null`) exactly when that function already
// says so, never guessed at.

import { priceWorkUnitOnDate, type PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';

export type DayImportField = 'date' | 'quantity' | 'scope' | 'client' | 'contract' | 'state';

/** The four columns a row cannot do without, plus the two that disambiguate
 * or override a default when present. Order here is the order the mapping
 * UI offers them in. */
export const DAY_IMPORT_REQUIRED_FIELDS = ['date', 'quantity', 'scope', 'client'] as const;
export const DAY_IMPORT_OPTIONAL_FIELDS = ['contract', 'state'] as const;

/** Which parsed column (0-based) carries each field, or `null` for one not
 * mapped yet. `contract`/`state` may stay `null` permanently — see
 * `buildDayImportReview`'s own fallback for each. */
export interface DayImportColumnMapping {
	readonly date: number | null;
	readonly quantity: number | null;
	readonly scope: number | null;
	readonly client: number | null;
	readonly contract: number | null;
	readonly state: number | null;
}

/** `DayImportColumnMapping` narrowed to what `buildDayImportReview` needs
 * to even start: every required field resolved to a real column index. */
export interface CompleteDayImportColumnMapping extends DayImportColumnMapping {
	readonly date: number;
	readonly quantity: number;
	readonly scope: number;
	readonly client: number;
}

export function isDayImportMappingComplete(
	mapping: DayImportColumnMapping
): mapping is CompleteDayImportColumnMapping {
	return (
		mapping.date !== null &&
		mapping.quantity !== null &&
		mapping.scope !== null &&
		mapping.client !== null
	);
}

/** Case-insensitive header aliases a column is recognised by, tried in
 * order — English first, then the Italian a self-hoster's own spreadsheet
 * is just as likely to carry (the interface is bilingual at launch per
 * AGENTS.md; a header name is presentational text a person typed, not a
 * jurisdiction rule, so matching both here is not invariant 1's
 * "no country-specific logic outside a jurisdiction pack" — nothing here
 * ever branches on the active pack or a country code). Never a substitute
 * for the mapping step itself: an unrecognised header always falls back to
 * asking, never to a guess silently applied. */
const FIELD_ALIASES: Readonly<Record<DayImportField, readonly string[]>> = {
	date: ['date', 'data', 'day', 'giorno'],
	quantity: ['quantity', 'qty', 'quantità', 'quantita', 'days', 'giorni'],
	scope: [
		'scope',
		'description',
		'descrizione',
		'oggetto',
		'notes',
		'note',
		'work',
		'attività',
		'attivita'
	],
	client: ['client', 'cliente', 'customer', 'azienda', 'company'],
	contract: ['contract', 'contratto', 'engagement'],
	state: ['state', 'status', 'stato']
};

/** A first guess at `DayImportColumnMapping` from `headers` alone, so the
 * mapping step opens pre-filled for the common case (a header row that
 * already reads `date,quantity,scope,client`) rather than six empty
 * pickers every time. Never applied without the reviewer seeing it: the
 * caller always renders this as an editable, not an assumed, mapping. */
export function suggestDayImportColumnMapping(headers: readonly string[]): DayImportColumnMapping {
	const normalized = headers.map((header) => header.trim().toLowerCase());
	function find(field: DayImportField): number | null {
		const index = normalized.findIndex((header) => FIELD_ALIASES[field].includes(header));
		return index === -1 ? null : index;
	}
	return {
		date: find('date'),
		quantity: find('quantity'),
		scope: find('scope'),
		client: find('client'),
		contract: find('contract'),
		state: find('state')
	};
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An ISO calendar date, real, not merely shaped like one: `2026-02-30`
 * fails even though it matches the regex `/day/new`'s own form validation
 * uses, because `Date.UTC` normalises an out-of-range day into the next
 * month and the round trip below catches the mismatch. */
export function parseImportedDate(raw: string): string | null {
	const trimmed = raw.trim();
	if (!ISO_DATE.test(trimmed)) return null;
	const [year, month, day] = trimmed.split('-').map(Number);
	const asDate = new Date(Date.UTC(year, month - 1, day));
	const roundTrips =
		asDate.getUTCFullYear() === year &&
		asDate.getUTCMonth() === month - 1 &&
		asDate.getUTCDate() === day;
	return roundTrips ? trimmed : null;
}

/** A positive quantity. Accepts a comma decimal separator only when the
 * cell carries no `.` already — the ambiguous case (a thousands grouping
 * versus a decimal comma) is never guessed at, it is left to fail as
 * `NaN` below and come back rejected. A quantity this small (a day
 * fraction, or hours) never needs a thousands separator regardless. */
export function parseImportedQuantity(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const normalized = trimmed.includes('.') ? trimmed : trimmed.replace(',', '.');
	const value = Number(normalized);
	return Number.isFinite(value) && value > 0 ? value : null;
}

export type DayImportRequestedState = 'worked' | 'proposed';

/** The state column's own two legal values (mirrors `DayEntryIntent` —
 * `work-unit-form.ts` — the only two states a human ever types in
 * directly; `createWorkUnit`'s own doc comment names bulk import as
 * exactly the other legal reason to insert `'worked'` outright). A blank
 * cell (no state column mapped, or the row's own cell empty) defaults to
 * `'worked'`: a bulk history import's whole point is loading days that
 * already happened. Anything else is a typo the reviewer must see named,
 * never silently coerced to one of the two. */
export function parseImportedState(raw: string): DayImportRequestedState | null {
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return 'worked';
	if (trimmed === 'worked' || trimmed === 'proposed') return trimmed;
	return null;
}

export interface DayImportCandidateContract {
	readonly id: string;
	readonly title: string;
	readonly currency: string;
	readonly requiresPriorApproval: boolean;
}

export interface DayImportCandidateClient {
	readonly id: string;
	readonly legalName: string;
	/** Only the client's own `active` contracts — see this module's header
	 * comment for why a draft, terminated or expired one is never a
	 * target, the same restriction `/day/new` already applies. */
	readonly activeContracts: readonly DayImportCandidateContract[];
}

/** `${contractId}|${date}` — the same pair the database's own
 * `work_unit_one_active_per_contract_date` partial unique index keys on,
 * so a key built here and a conflict the database raises at persist time
 * always agree on what "the same day" means. */
export function dayImportKey(contractId: string, date: string): string {
	return `${contractId}|${date}`;
}

/** Every contract+date pair already carrying a "live" day (any state but
 * `rejected`/`revoked` — the two the unique index itself excludes), mapped
 * to that day's current state so a rejected row can say what it collided
 * with. */
export type DayImportExistingStateByKey = ReadonlyMap<string, WorkUnitState>;

export type DayImportRejectReason =
	| { readonly kind: 'missing_field'; readonly field: DayImportField }
	| { readonly kind: 'invalid_date'; readonly raw: string }
	| { readonly kind: 'invalid_quantity'; readonly raw: string }
	| { readonly kind: 'invalid_state'; readonly raw: string }
	| { readonly kind: 'unknown_client'; readonly raw: string }
	| { readonly kind: 'no_active_contract'; readonly clientLegalName: string }
	| { readonly kind: 'ambiguous_contract'; readonly clientLegalName: string }
	| { readonly kind: 'unknown_contract'; readonly raw: string; readonly clientLegalName: string }
	| { readonly kind: 'duplicate_in_batch'; readonly firstRowNumber: number }
	| { readonly kind: 'already_recorded'; readonly existingState: WorkUnitState };

/** A row ready to become a day. `requestedState` is what the row itself
 * asked for; `resultingState` is what the state machine trigger
 * (`0012_work_unit_state_machine.sql`, widened by #23) will actually
 * record it as — `requestedState` unless it is `'worked'` on a contract
 * that requires prior approval, which an import never carries an
 * `approval_id` for, so the trigger lands it in `worked_without_approval`
 * automatically. Predicted here, not merely left to be discovered after
 * confirming, so the dry run's "the right state" is provable before
 * anything is written. */
export interface DayImportValidRow {
	readonly kind: 'valid';
	readonly rowNumber: number;
	readonly raw: readonly string[];
	readonly contractId: string;
	readonly clientLegalName: string;
	readonly contractTitle: string;
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly requestedState: DayImportRequestedState;
	readonly resultingState: WorkUnitState;
	readonly currency: string;
	/** A major-unit preview, `priceWorkUnitOnDate`'s own contract: `null`
	 * when no rate card in force on `date` prices this quantity, shown
	 * unpriced rather than guessed at, same as the month calendar already
	 * does for a day with none. Never written — `work_unit` has no price
	 * column, a rate card prices a day at invoicing time, not on entry. */
	readonly previewAmount: number | null;
}

export interface DayImportRejectedRow {
	readonly kind: 'rejected';
	readonly rowNumber: number;
	readonly raw: readonly string[];
	readonly reason: DayImportRejectReason;
}

export type DayImportRowOutcome = DayImportValidRow | DayImportRejectedRow;

export interface DayImportReview {
	/** Rows actually considered — a fully blank line (a trailing newline,
	 * a stray gap a spreadsheet export leaves behind) is not counted: it
	 * is not a row a human typed wrong, it is not a row at all. */
	readonly totalRows: number;
	readonly outcomes: readonly DayImportRowOutcome[];
}

/**
 * Computes the whole dry run in one pass over `rows` (data rows only, no
 * header), in file order, numbering only the rows that are not entirely
 * blank starting at 1. `existingStateByKey` is read, never mutated, so a
 * second `buildDayImportReview` call over the same rows (the confirm
 * endpoint's own re-validation, mirroring `persist.ts`'s "the structured
 * document wins" — nothing here is trusted from a prior review computed a
 * request or a browser round trip ago) reproduces exactly the same
 * outcomes for exactly the same database state.
 */
export function buildDayImportReview(
	rows: readonly (readonly string[])[],
	mapping: CompleteDayImportColumnMapping,
	clients: readonly DayImportCandidateClient[],
	rateCardsByContractId: ReadonlyMap<string, readonly PriceableRateCard[]>,
	existingStateByKey: DayImportExistingStateByKey = new Map()
): DayImportReview {
	const clientsByName = new Map(
		clients.map((client) => [client.legalName.trim().toLowerCase(), client])
	);
	const seenInBatch = new Map<string, number>();
	const outcomes: DayImportRowOutcome[] = [];

	const cell = (raw: readonly string[], index: number | null): string =>
		index === null ? '' : (raw[index] ?? '');

	let rowNumber = 0;
	for (const raw of rows) {
		if (raw.every((value) => value.trim() === '')) continue;
		rowNumber += 1;

		const dateRaw = cell(raw, mapping.date);
		const quantityRaw = cell(raw, mapping.quantity);
		const scopeRaw = cell(raw, mapping.scope).trim();
		const clientRaw = cell(raw, mapping.client).trim();
		const contractRaw = cell(raw, mapping.contract).trim();
		const stateRaw = cell(raw, mapping.state);

		const missingField: DayImportField | null = !dateRaw.trim()
			? 'date'
			: !quantityRaw.trim()
				? 'quantity'
				: !scopeRaw
					? 'scope'
					: !clientRaw
						? 'client'
						: null;
		if (missingField) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'missing_field', field: missingField }
			});
			continue;
		}

		const date = parseImportedDate(dateRaw);
		if (!date) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'invalid_date', raw: dateRaw.trim() }
			});
			continue;
		}

		const quantity = parseImportedQuantity(quantityRaw);
		if (quantity === null) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'invalid_quantity', raw: quantityRaw.trim() }
			});
			continue;
		}

		const requestedState = parseImportedState(stateRaw);
		if (requestedState === null) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'invalid_state', raw: stateRaw.trim() }
			});
			continue;
		}

		const client = clientsByName.get(clientRaw.toLowerCase());
		if (!client) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'unknown_client', raw: clientRaw }
			});
			continue;
		}

		let contract: DayImportCandidateContract;
		if (contractRaw) {
			const matched = client.activeContracts.find(
				(candidate) => candidate.title.trim().toLowerCase() === contractRaw.toLowerCase()
			);
			if (!matched) {
				outcomes.push({
					kind: 'rejected',
					rowNumber,
					raw,
					reason: { kind: 'unknown_contract', raw: contractRaw, clientLegalName: client.legalName }
				});
				continue;
			}
			contract = matched;
		} else if (client.activeContracts.length === 0) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'no_active_contract', clientLegalName: client.legalName }
			});
			continue;
		} else if (client.activeContracts.length > 1) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'ambiguous_contract', clientLegalName: client.legalName }
			});
			continue;
		} else {
			contract = client.activeContracts[0];
		}

		const key = dayImportKey(contract.id, date);
		const existingState = existingStateByKey.get(key);
		if (existingState) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'already_recorded', existingState }
			});
			continue;
		}
		const firstRowNumber = seenInBatch.get(key);
		if (firstRowNumber !== undefined) {
			outcomes.push({
				kind: 'rejected',
				rowNumber,
				raw,
				reason: { kind: 'duplicate_in_batch', firstRowNumber }
			});
			continue;
		}
		seenInBatch.set(key, rowNumber);

		const resultingState: WorkUnitState =
			requestedState === 'proposed'
				? 'proposed'
				: contract.requiresPriorApproval
					? 'worked_without_approval'
					: 'worked';
		const previewAmount = priceWorkUnitOnDate(
			{ date, quantity },
			rateCardsByContractId.get(contract.id) ?? []
		);

		outcomes.push({
			kind: 'valid',
			rowNumber,
			raw,
			contractId: contract.id,
			clientLegalName: client.legalName,
			contractTitle: contract.title,
			date,
			quantity,
			scope: scopeRaw,
			requestedState,
			resultingState,
			currency: contract.currency,
			previewAmount
		});
	}

	return { totalRows: rowNumber, outcomes };
}
