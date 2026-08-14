import type { WorkUnitStateValue } from '$lib/design';

// Client-side mirror of the JSON `/import/days/analyze` and
// `/import/days/confirm` responses. Deliberately not imported from
// `$lib/server/import/day-import.ts`: that lives under `$lib/server`,
// which SvelteKit refuses to bundle into client code, and a JSON round
// trip already erases the distinction between the two shapes — same
// reasoning `routes/import/types.ts` gives for its own duplicate. Every
// state name is `WorkUnitStateValue`, imported from `$lib/design` rather
// than redeclared a third time: that module already exists for exactly
// this (client-safe, used by the calendar and alerts already).

export type DayImportField = 'date' | 'quantity' | 'scope' | 'client' | 'contract' | 'state';

export interface DayImportColumnMapping {
	date: number | null;
	quantity: number | null;
	scope: number | null;
	client: number | null;
	contract: number | null;
	state: number | null;
}

export type DayImportRejectReason =
	| { kind: 'missing_field'; field: DayImportField }
	| { kind: 'invalid_date'; raw: string }
	| { kind: 'invalid_quantity'; raw: string }
	| { kind: 'invalid_state'; raw: string }
	| { kind: 'unknown_client'; raw: string }
	| { kind: 'no_active_contract'; clientLegalName: string }
	| { kind: 'ambiguous_contract'; clientLegalName: string }
	| { kind: 'unknown_contract'; raw: string; clientLegalName: string }
	| { kind: 'duplicate_in_batch'; firstRowNumber: number }
	| { kind: 'already_recorded'; existingState: WorkUnitStateValue };

export interface DayImportValidRow {
	kind: 'valid';
	rowNumber: number;
	raw: string[];
	contractId: string;
	clientLegalName: string;
	contractTitle: string;
	date: string;
	quantity: number;
	scope: string;
	requestedState: 'worked' | 'proposed';
	resultingState: WorkUnitStateValue;
	currency: string;
	previewAmount: number | null;
}

export interface DayImportRejectedRow {
	kind: 'rejected';
	rowNumber: number;
	raw: string[];
	reason: DayImportRejectReason;
}

export type DayImportRowOutcome = DayImportValidRow | DayImportRejectedRow;

export interface DayImportNeedsMappingResponse {
	kind: 'needs_mapping';
	headers: string[];
	sampleRows: string[][];
	suggestedMapping: DayImportColumnMapping;
}

export interface DayImportReviewResponse {
	kind: 'review';
	totalRows: number;
	outcomes: DayImportRowOutcome[];
}

export type DayImportAnalyzeResponse = DayImportNeedsMappingResponse | DayImportReviewResponse;

export interface DayImportConfirmResponse {
	filename: string;
	totalRows: number;
	rejected: DayImportRejectedRow[];
	created: { kind: 'created'; rowNumber: number; workUnitId: string; state: WorkUnitStateValue }[];
	alreadyRecorded: { kind: 'already_recorded'; rowNumber: number }[];
	failed: { kind: 'failed'; rowNumber: number; message: string }[];
}
