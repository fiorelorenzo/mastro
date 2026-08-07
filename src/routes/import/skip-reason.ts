import * as m from '$lib/paraglide/messages';
import type { SkipReason } from './types';

/** The reason a file was skipped, in the active locale — every skipped
 * file lists one of these (#47's acceptance), including the incoming
 * invoices direction detection rejects. */
export function skipReasonLabel(reason: SkipReason): string {
	switch (reason.kind) {
		case 'unrecognised_format':
			return m.import_skip_reason_unrecognised_format();
		case 'malformed_document':
			return m.import_skip_reason_malformed_document({ message: reason.message });
		case 'incoming_invoice':
			return m.import_skip_reason_incoming_invoice({
				supplierTaxId: reason.reason.supplierTaxId
			});
	}
}
