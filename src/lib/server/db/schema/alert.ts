import { boolean, integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

/**
 * Every alert the engine (#74) can detect. Plain text with a widened-by-
 * migration CHECK constraint, not a Postgres enum — the same tradeoff
 * `document.ownerType` makes and for the same reason: a new alert type is
 * a metadata-only addition (widen the CHECK), never an `ALTER TYPE ... ADD
 * VALUE` whose new label cannot be used inside the transaction that adds
 * it. The eight are epic #13's own list; `backup_failure`, `mirror_
 * failure`, `mailbox_poll_failure` and `agent_run_failure` are not on
 * that table but exist because `backup_run` (#77), `document_mirror_run`
 * (#50), `mailbox_poll_run` (#84) and `agent_run` (#222) were each built
 * with exactly this engine as their stated reader — see those tables'
 * own doc comments.
 */
export const ALERT_TYPES = [
	'contract_expiring',
	'renewal_window_open',
	'worked_without_approval',
	'approval_unactioned',
	'invoice_overdue',
	'billable_period_closed',
	'ceiling_approaching',
	'year_end_overrun_risk',
	'backup_failure',
	'mirror_failure',
	'mailbox_poll_failure',
	'agent_run_failure'
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * The three severities an alert *instance* can carry — `good` never
 * appears here, an alert only exists for a condition that is not good.
 * Deliberately the same fixed, reserved scale `$lib/design`'s
 * `StatusLevel` defines (minus `good`), not a parallel one: severity is
 * status, and status is never themed twice in this product.
 */
export const ALERT_SEVERITIES = ['warning', 'serious', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const alertDeliveryChannel = pgEnum('alert_delivery_channel', ['push', 'digest']);
export type AlertDeliveryChannel = (typeof alertDeliveryChannel.enumValues)[number];

/**
 * Acknowledgement (#74), keyed by an alert's own stable `key` (see
 * `$lib/server/alerts/types.ts`'s `alertKey`) rather than by a row on
 * whichever domain table the alert reads from: eight of the ten alert
 * types are pure queries with no row of their own to attach an
 * `acknowledged_at` to, and giving the other two (`backup_failure`,
 * `mirror_failure`) a second, different mechanism than the other eight
 * would be the one alert screen with two kinds of "acknowledge" button.
 * `backup_run.acknowledged_at`/`document_mirror_run.acknowledged_at`
 * (written before this engine existed) are left as-is and unused by it —
 * see the PR description.
 *
 * `severityRank` is the severity *at the moment of acknowledgement*
 * (`SEVERITY_RANK[alert.severity]`, `$lib/server/alerts/types.ts`): the
 * acknowledgement only suppresses recurrence up to that rank. A later
 * detection at a strictly higher rank (the condition got worse) makes the
 * row stale rather than deleting it — "acknowledging is not resolving",
 * so the row, and the fact that it was once acknowledged, stays. Upserted
 * on `alertKey`, never duplicated: re-acknowledging the same alert
 * updates the existing row.
 */
export const alertAcknowledgement = pgTable(
	'alert_acknowledgement',
	{
		id: id(),
		alertKey: text('alert_key').notNull(),
		alertType: text('alert_type').notNull(),
		severityRank: integer('severity_rank').notNull(),
		acknowledgedBy: text('acknowledged_by').notNull(),
		...timestamps()
	},
	(table) => [unique('alert_acknowledgement_alert_key_key').on(table.alertKey)]
);

/**
 * Delivery bookkeeping (#75): the highest severity rank an alert has
 * already been sent at, through either channel — this is the dedup #74
 * asks for ("the same alert must not fire daily forever"), channel-
 * agnostic on purpose. An urgent alert pushed today is not repeated in
 * next week's digest at the same severity; if it later escalates, the
 * higher rank clears the dedup and it is eligible again, on whichever
 * channel runs next. Upserted on `alertKey`, same shape as
 * `alertAcknowledgement`.
 */
export const alertDelivery = pgTable(
	'alert_delivery',
	{
		id: id(),
		alertKey: text('alert_key').notNull(),
		alertType: text('alert_type').notNull(),
		severityRank: integer('severity_rank').notNull(),
		channel: alertDeliveryChannel('channel').notNull(),
		...timestamps()
	},
	(table) => [unique('alert_delivery_alert_key_key').on(table.alertKey)]
);

/**
 * Per-type delivery preference (#75, #63). No row for a type means both
 * channels default on — a missing preference must never mean "silent",
 * only an explicit `false` does: the whole point of this engine is that
 * no contractual deadline passes unnoticed, so the failure mode of an
 * unconfigured preference has to be "still tells you", not the reverse.
 * One row per type, created lazily the first time a human changes it away
 * from the default (`$lib/server/alerts/state.ts`'s `setAlertPreference`).
 */
export const alertPreference = pgTable(
	'alert_preference',
	{
		id: id(),
		alertType: text('alert_type').notNull(),
		digestEnabled: boolean('digest_enabled').notNull().default(true),
		pushEnabled: boolean('push_enabled').notNull().default(true),
		...timestamps()
	},
	(table) => [unique('alert_preference_alert_type_key').on(table.alertType)]
);
