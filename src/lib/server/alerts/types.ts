// The alert set (#74, epic #13), as a discriminated union rather than a
// stored row shape: every alert is a query over the ledger, computed
// fresh on every call (`detectAlerts` in `engine.ts`). Nothing in this
// file, or in `detectors.ts`, ever writes to the database — the only
// persistence in the whole feature is the bookkeeping in `state.ts`
// (acknowledgement, delivery, preference), which is deliberately a
// separate, much smaller surface.

import type { AlertType } from '$lib/server/db/schema/alert';
export { ALERT_TYPES, ALERT_SEVERITIES } from '$lib/server/db/schema/alert';
export type { AlertType, AlertSeverity, AlertDeliveryChannel } from '$lib/server/db/schema/alert';
import type { AlertSeverity } from '$lib/server/db/schema/alert';
import type { ContractRenewalType } from '$lib/server/db/schema/contract';
import type { LabelBundle } from '$lib/server/fiscal/label';

/** `warning` < `serious` < `critical` — the ordering acknowledgement and
 * delivery dedup compare against (`state.ts`): a later detection ranked
 * strictly higher than what was last seen clears both. */
export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
	warning: 1,
	serious: 2,
	critical: 3
};

/** The one severity that routes to immediate push rather than the weekly
 * digest (#75's "an alert about a contract that expires in five days is
 * useless in a monthly summary") — a property of how bad *this instance*
 * currently is, never of the alert type: the same contract's expiry alert
 * is a `warning` at 30 days out and `critical` at 7. */
export const URGENT_SEVERITY: AlertSeverity = 'critical';

export function isUrgent(severity: AlertSeverity): boolean {
	return severity === URGENT_SEVERITY;
}

/** Deterministic identity for one alert *occurrence*, stable across
 * recomputations: `${type}:${subjectId}` — a contract id, a work unit id,
 * an approval id, an invoice id, a ceiling id, a document id, or the
 * literal `'global'` for the one alert with no natural subject
 * (`backup_failure`). This is what `alert_acknowledgement` and
 * `alert_delivery` key on, and what a re-detection has to reproduce
 * exactly for dedup/acknowledgement to find the same row again. */
export function alertKey(type: AlertType, subjectId: string): string {
	return `${type}:${subjectId}`;
}

export type AlertDetail =
	| {
			readonly type: 'contract_expiring';
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly endsOn: string;
			readonly daysUntilEnd: number;
	  }
	| {
			readonly type: 'renewal_window_open';
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly endsOn: string;
			readonly renewalType: Exclude<ContractRenewalType, 'none'>;
			readonly daysUntilEnd: number;
	  }
	| {
			readonly type: 'worked_without_approval';
			readonly workUnitId: string;
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly date: string;
			readonly sinceAt: string;
	  }
	| {
			readonly type: 'approval_unactioned';
			readonly approvalId: string;
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly receivedAt: string;
			readonly daysUnactioned: number;
	  }
	| {
			readonly type: 'invoice_overdue';
			readonly invoiceId: string;
			readonly invoiceNumber: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly dueDate: string;
			readonly daysLate: number;
			readonly total: number;
			readonly currency: string;
	  }
	| {
			readonly type: 'billable_period_closed';
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly periodEnd: string;
			readonly dayCount: number;
	  }
	| {
			readonly type: 'ceiling_approaching';
			readonly ceilingId: string;
			readonly ceilingLabel: LabelBundle;
			readonly consequence: LabelBundle;
			readonly usageRatio: number;
			readonly currentValue: number;
			readonly limitValue: number;
	  }
	| {
			readonly type: 'year_end_overrun_risk';
			readonly ceilingId: string;
			readonly ceilingLabel: LabelBundle;
			readonly consequence: LabelBundle;
			readonly projectedValue: number;
			readonly limitValue: number;
			readonly periodEnd: string;
	  }
	| {
			readonly type: 'backup_failure';
			readonly reason: 'failure' | 'stale' | 'never_run';
			readonly detail: string | null;
			readonly lastRunAt: string | null;
	  }
	| {
			readonly type: 'mirror_failure';
			readonly documentId: string;
			readonly contractId: string;
			readonly clientId: string;
			readonly contractTitle: string;
			readonly clientLegalName: string;
			readonly reason: 'failure' | 'stale';
			readonly detail: string | null;
			readonly since: string;
	  }
	| {
			readonly type: 'mailbox_poll_failure';
			readonly reason: 'failure' | 'stale' | 'never_run';
			readonly detail: string | null;
			readonly lastRunAt: string | null;
	  };

export interface Alert {
	readonly key: string;
	readonly severity: AlertSeverity;
	readonly detail: AlertDetail;
}

export function makeAlert(subjectId: string, severity: AlertSeverity, detail: AlertDetail): Alert {
	return { key: alertKey(detail.type, subjectId), severity, detail };
}
