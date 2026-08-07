// Acknowledgement, delivery dedup and per-type preference (#74, #75, #63)
// — the only persistence this feature has. Detection itself
// (`detectors.ts`, `engine.ts`) never touches the database for a write;
// everything here is bookkeeping *about* a detected alert, keyed by its
// own stable `key` (`types.ts`'s `alertKey`), never a stored copy of the
// alert itself.

import { db, type DbExecutor } from '$lib/server/db';
import {
	alertAcknowledgement,
	alertDelivery,
	alertPreference,
	type AlertDeliveryChannel
} from '$lib/server/db/schema/alert';
import { SEVERITY_RANK, type Alert, type AlertSeverity, type AlertType } from './types';

export interface AcknowledgementState {
	readonly severityRank: number;
	readonly acknowledgedAt: Date;
	readonly acknowledgedBy: string;
}

export interface DeliveryState {
	readonly severityRank: number;
	readonly deliveredAt: Date;
	readonly channel: AlertDeliveryChannel;
}

/** Every acknowledgement on record, keyed by `alertKey` — one round trip,
 * read once per `listActiveAlerts`/dispatch run rather than a query per
 * alert. */
export async function listAcknowledgements(
	executor: DbExecutor = db
): Promise<Map<string, AcknowledgementState>> {
	const rows = await executor.select().from(alertAcknowledgement);
	return new Map(
		rows.map((row) => [
			row.alertKey,
			{
				severityRank: row.severityRank,
				acknowledgedAt: row.updatedAt,
				acknowledgedBy: row.acknowledgedBy
			}
		])
	);
}

/** Every delivery record on record, keyed by `alertKey` — same shape and
 * reason as `listAcknowledgements`. */
export async function listDeliveries(
	executor: DbExecutor = db
): Promise<Map<string, DeliveryState>> {
	const rows = await executor.select().from(alertDelivery);
	return new Map(
		rows.map((row) => [
			row.alertKey,
			{ severityRank: row.severityRank, deliveredAt: row.updatedAt, channel: row.channel }
		])
	);
}

/** True once `state` (an acknowledgement or a delivery record) already
 * covers `severity` — i.e. it was last seen at this rank or higher, so
 * telling the human again would be the "fire daily forever" #74's
 * acceptance rules out. A strictly higher severity than what `state`
 * covers is never suppressed: the condition got worse, which is always
 * worth a fresh notification even if the type itself was already seen. */
export function covers(
	state: { readonly severityRank: number } | undefined,
	severity: AlertSeverity
): boolean {
	return state !== undefined && SEVERITY_RANK[severity] <= state.severityRank;
}

/** Acknowledges one alert occurrence: "seen it, do not repeat this until
 * it changes" — the record stays (nothing here ever deletes one), so the
 * dashboard can still show that it was once acknowledged even after a
 * later escalation reopens it. Upserted on `alertKey`: re-acknowledging
 * the same alert (e.g. after it reopened at a higher severity) refreshes
 * the rank and who acknowledged it, rather than adding a second row. */
export async function acknowledgeAlert(
	alert: Alert,
	acknowledgedBy: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.insert(alertAcknowledgement)
		.values({
			alertKey: alert.key,
			alertType: alert.detail.type,
			severityRank: SEVERITY_RANK[alert.severity],
			acknowledgedBy
		})
		.onConflictDoUpdate({
			target: alertAcknowledgement.alertKey,
			set: { severityRank: SEVERITY_RANK[alert.severity], acknowledgedBy }
		});
}

/** Records that `alert` was just sent over `channel` — dedup bookkeeping
 * for `state.ts`'s `covers`, shared across push and digest on purpose
 * (#75's "the same alert must not fire daily forever" does not care which
 * channel already told the human). Upserted on `alertKey`, same shape as
 * `acknowledgeAlert`. */
export async function recordDelivery(
	alert: Alert,
	channel: AlertDeliveryChannel,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.insert(alertDelivery)
		.values({
			alertKey: alert.key,
			alertType: alert.detail.type,
			severityRank: SEVERITY_RANK[alert.severity],
			channel
		})
		.onConflictDoUpdate({
			target: alertDelivery.alertKey,
			set: { severityRank: SEVERITY_RANK[alert.severity], channel }
		});
}

export interface AlertPreferenceState {
	readonly digestEnabled: boolean;
	readonly pushEnabled: boolean;
}

const DEFAULT_PREFERENCE: AlertPreferenceState = { digestEnabled: true, pushEnabled: true };

/** Every type's preference, defaulting a type with no row to both
 * channels on (`db/schema/alert.ts`'s `alertPreference` doc comment) —
 * callers read through `Map.get(type) ?? DEFAULT_PREFERENCE`, never treat
 * a missing entry as off. */
export async function listAlertPreferences(
	executor: DbExecutor = db
): Promise<Map<AlertType, AlertPreferenceState>> {
	const rows = await executor.select().from(alertPreference);
	return new Map(
		rows.map((row) => [
			row.alertType as AlertType,
			{ digestEnabled: row.digestEnabled, pushEnabled: row.pushEnabled }
		])
	);
}

export { DEFAULT_PREFERENCE };

/** Sets both channels for one type at once — the preferences form always
 * submits the full pair, never one flag alone, so there is no partial-
 * update case to reconcile against whatever the row previously held. */
export async function setAlertPreference(
	type: AlertType,
	preference: AlertPreferenceState,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.insert(alertPreference)
		.values({ alertType: type, ...preference })
		.onConflictDoUpdate({ target: alertPreference.alertType, set: { ...preference } });
}
