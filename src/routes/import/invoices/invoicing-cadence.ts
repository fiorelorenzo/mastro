import * as m from '$lib/paraglide/messages';
import type { InvoicingCadence } from './types';

export const invoicingCadences: readonly InvoicingCadence[] = [
	'monthly',
	'quarterly',
	'annual',
	'on_completion'
];

/** Human-readable label for an invoicing cadence in the active locale.
 * Mirrors `clients/notice-channel.ts`'s `noticeChannelLabel`. */
export function invoicingCadenceLabel(cadence: InvoicingCadence): string {
	switch (cadence) {
		case 'monthly':
			return m.import_cadence_monthly();
		case 'quarterly':
			return m.import_cadence_quarterly();
		case 'annual':
			return m.import_cadence_annual();
		case 'on_completion':
			return m.import_cadence_on_completion();
	}
}
