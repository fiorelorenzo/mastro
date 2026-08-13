/**
 * `Badge` bindings for the states a day-recording UI has to represent:
 * the ten `work_unit_state` values plus the one pre-persistence pseudo
 * state a day visibly passes through before it is ever a database row —
 * `QueuedDayStatus`, split into `pending`/`syncing`/`failed` in the UI —
 * eleven states in total (`docs/specs/ux-review/04-day-lifecycle.md:310-315`).
 * One home, one mapping, so the day surfaces, the month calendar and
 * alerts render a given state identically instead of three call sites
 * each choosing a colour by hand.
 *
 * `workUnitStates` is duplicated from `$lib/server/db/schema/work-unit.ts`
 * rather than imported, for the same reason `routes/day/work-unit-state.ts`
 * and `routes/proposals/proposal-status.ts` already duplicate their own
 * enums: this module ships to the client (calendar, alerts), and
 * `$lib/server/db/schema` cannot be bundled into client code. It is kept
 * here rather than re-exported from `routes/day/work-unit-state.ts`
 * because `$lib/design` must not depend on a route.
 *
 * `Record<State, X>` rather than a `switch`: adding a twelfth state to
 * either union without adding its row here is a missing-property compile
 * error, not a silently-unhandled branch — the exhaustiveness the task
 * asks for, enforced by the type checker rather than a lint rule.
 */

import * as m from '$lib/paraglide/messages';
import type { QueuedDayStatus } from '$lib/pwa/offline-queue';
import { BADGE_GLYPH, type BadgeVariant } from './badge-variants';

export const workUnitStates = [
	'proposed',
	'approved',
	'worked',
	'worked_without_approval',
	'invoiced',
	'paid',
	'disputed',
	'revoked',
	'rejected',
	'unbillable'
] as const;

export type WorkUnitStateValue = (typeof workUnitStates)[number];

export interface StateBadge {
	variant: BadgeVariant;
	/** Same character `Badge` itself renders for `variant` — kept on the
	 *  return value too so a caller that only needs the glyph (a compact
	 *  calendar cell, say) does not have to re-derive it. */
	glyph: string;
	label: string;
}

function badge(variant: BadgeVariant, label: string): StateBadge {
	return { variant, glyph: BADGE_GLYPH[variant], label };
}

/**
 * `worked_without_approval` is the one state the product needs unmistakable
 * (README.md's own framing: "the branch that matters most"). It is the
 * only day state mapped to `critical` — every other state that also reads
 * as a problem (`disputed`, `rejected`) is deliberately a step down
 * (`serious`/`warning`), so `critical` stays exclusive to the state that
 * represents unrecorded legal risk and never gets diluted by sharing its
 * colour with something less urgent.
 */
const WORK_UNIT_STATE_BADGE: Readonly<Record<WorkUnitStateValue, StateBadge>> = {
	proposed: badge('neutral', m.day_state_proposed()),
	approved: badge('info', m.day_state_approved()),
	worked: badge('good', m.day_state_worked()),
	worked_without_approval: badge('critical', m.day_state_worked_without_approval()),
	invoiced: badge('info', m.day_state_invoiced()),
	paid: badge('good', m.day_state_paid()),
	disputed: badge('serious', m.day_state_disputed()),
	revoked: badge('neutral', m.day_state_revoked()),
	rejected: badge('warning', m.day_state_rejected()),
	unbillable: badge('neutral', m.day_state_unbillable())
};

/** The `{ variant, glyph, label }` a `Badge` needs to render `state`. */
export function workUnitStateBadge(state: WorkUnitStateValue): StateBadge {
	return WORK_UNIT_STATE_BADGE[state];
}

/**
 * The offline queue's own three-value status (`pending`/`syncing`/`failed`,
 * `$lib/pwa/offline-queue.ts`) is not a `work_unit_state` — it describes a
 * day that has no server row yet — so it gets its own exhaustive table
 * rather than being folded into `WORK_UNIT_STATE_BADGE`. `failed` is
 * `warning`, not `critical`: it is a local, retriable sync problem, and
 * `critical` stays reserved for `worked_without_approval` above.
 */
const QUEUED_DAY_STATUS_BADGE: Readonly<Record<QueuedDayStatus, StateBadge>> = {
	pending: badge('neutral', m.day_offline_pending_status_pending()),
	syncing: badge('info', m.day_offline_pending_status_syncing()),
	failed: badge('warning', m.day_offline_pending_status_failed())
};

/** The `{ variant, glyph, label }` a `Badge` needs to render a queued
 *  offline day's `status`. */
export function queuedDayStatusBadge(status: QueuedDayStatus): StateBadge {
	return QUEUED_DAY_STATUS_BADGE[status];
}
