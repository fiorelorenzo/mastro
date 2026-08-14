// The reason a row was rejected, in the active locale — every rejected row
// lists one of these (#224's "a malformed row is named"), mirroring
// `../skip-reason.ts`'s role for the invoice importer.
import * as m from '$lib/paraglide/messages';
import { workUnitStateBadge } from '$lib/design';
import type { DayImportField, DayImportRejectReason } from './types';

export function dayImportFieldLabel(field: DayImportField): string {
	switch (field) {
		case 'date':
			return m.day_form_date_label();
		case 'quantity':
			return m.day_detail_quantity_label();
		case 'scope':
			return m.day_detail_scope_label();
		case 'client':
			return m.import_column_client();
		case 'contract':
			return m.day_detail_contract_label();
		case 'state':
			return m.day_detail_state_label();
	}
}

export function dayImportRejectReasonLabel(reason: DayImportRejectReason): string {
	switch (reason.kind) {
		case 'missing_field':
			return m.import_days_reject_missing_field({ field: dayImportFieldLabel(reason.field) });
		case 'invalid_date':
			return m.import_days_reject_invalid_date({ raw: reason.raw });
		case 'invalid_quantity':
			return m.import_days_reject_invalid_quantity({ raw: reason.raw });
		case 'invalid_state':
			return m.import_days_reject_invalid_state({ raw: reason.raw });
		case 'unknown_client':
			return m.import_days_reject_unknown_client({ raw: reason.raw });
		case 'no_active_contract':
			return m.import_days_reject_no_active_contract({ clientLegalName: reason.clientLegalName });
		case 'ambiguous_contract':
			return m.import_days_reject_ambiguous_contract({ clientLegalName: reason.clientLegalName });
		case 'unknown_contract':
			return m.import_days_reject_unknown_contract({
				raw: reason.raw,
				clientLegalName: reason.clientLegalName
			});
		case 'duplicate_in_batch':
			return m.import_days_reject_duplicate_in_batch({ firstRowNumber: reason.firstRowNumber });
		case 'already_recorded':
			return m.import_days_reject_already_recorded({
				existingState: workUnitStateBadge(reason.existingState).label
			});
	}
}
