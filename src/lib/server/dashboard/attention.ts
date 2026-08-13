// The dashboard's "needs you today" queue (#234): every active
// worked_without_approval, invoice_overdue or ceiling alert, in the
// alert engine's own severity order, plus one synthetic row for
// proposals still pending — never a second detection pass, only a
// filter over `listActiveAlerts`'s own output re-rendered through
// `alertMessage`/`alertResolution`, the exact title/body/link mapping
// `/alerts` (#220) already uses. This is the module the issue asks for
// by name: "Wave 2's alertResolution mapping gives you the link and
// action for each attention row — reuse it rather than inventing a
// second mapping."

import type { Locale } from '$lib/paraglide/runtime';
import { alertResolution, type AlertResolution } from '$lib/server/alerts/actions';
import { alertMessage, type AlertMessage } from '$lib/server/alerts/render';
import type { ActiveAlert } from '$lib/server/alerts/engine';
import type { AlertSeverity, AlertType } from '$lib/server/alerts/types';

/**
 * The alert types the issue names by name — "days at risk, invoices
 * overdue, ceilings approaching": `worked_without_approval` is always
 * `critical`; `invoice_overdue` and `ceiling_approaching`/
 * `year_end_overrun_risk` carry whatever severity the engine assigned
 * them. Every other type (contract deadlines, approval backlog, system
 * health, mirror failures…) stays `/alerts`-only — this queue is "what
 * needs you today", not a second copy of the full alert list.
 */
const ATTENTION_ALERT_TYPES: readonly AlertType[] = [
	'worked_without_approval',
	'invoice_overdue',
	'ceiling_approaching',
	'year_end_overrun_risk'
];

export interface AttentionRow extends AlertMessage, AlertResolution {
	readonly key: string;
	/** `'info'` is not a real `AlertSeverity` — it is the one row this
	 * module invents itself (pending proposals), matching the mockup's
	 * own `.att--info` rail, distinct from and below every real alert
	 * severity. */
	readonly severity: AlertSeverity | 'info';
}

/**
 * `alerts` (already sorted most-severe-first by `listActiveAlerts`),
 * narrowed to `ATTENTION_ALERT_TYPES` and re-rendered through the same
 * mapping `/alerts` uses. `pendingProposalsRow`, when given, is appended
 * last: proposals are not `AlertDetail`s (#83's own type has no
 * `'pending_proposal'` case, by design — a proposal is a producer's
 * output awaiting a decision, not a condition the ledger detects), so
 * there is nothing in the alert engine to filter for them; the caller
 * builds that one row itself (`+page.server.ts`) and hands it in.
 */
export function buildAttentionRows(
	alerts: readonly ActiveAlert[],
	locale: Locale,
	pendingProposalsRow: AttentionRow | null
): AttentionRow[] {
	const rows = alerts
		.filter((alert) => ATTENTION_ALERT_TYPES.includes(alert.detail.type))
		.map((alert) => ({
			key: alert.key,
			severity: alert.severity,
			...alertMessage(alert, locale),
			...alertResolution(alert.detail, locale)
		}));
	return pendingProposalsRow ? [...rows, pendingProposalsRow] : rows;
}
