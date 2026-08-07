import * as m from '$lib/paraglide/messages';

/**
 * Mirrors the `work_unit_state` Postgres enum
 * (`$lib/server/db/schema/work-unit.ts`), duplicated here as a plain
 * literal list rather than imported: this file is used from client
 * components (`DayStateBadge.svelte`, the month calendar), and
 * `$lib/server/db/schema` cannot be bundled into client code — the same
 * reason `routes/clients/notice-channel.ts` duplicates `notice_channel`.
 */
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

export function workUnitStateLabel(state: WorkUnitStateValue): string {
	switch (state) {
		case 'proposed':
			return m.day_state_proposed();
		case 'approved':
			return m.day_state_approved();
		case 'worked':
			return m.day_state_worked();
		case 'worked_without_approval':
			return m.day_state_worked_without_approval();
		case 'invoiced':
			return m.day_state_invoiced();
		case 'paid':
			return m.day_state_paid();
		case 'disputed':
			return m.day_state_disputed();
		case 'revoked':
			return m.day_state_revoked();
		case 'rejected':
			return m.day_state_rejected();
		case 'unbillable':
			return m.day_state_unbillable();
	}
}

/**
 * Whether a day in `state` counts toward the month calendar's "days
 * worked" total (#25): everything past the pre-work states
 * (`proposed`/`approved` have not happened yet) and past the states where
 * the day turned out not to happen at all (`rejected`, `revoked`).
 * `unbillable` still counts here — the labor happened — but never toward
 * the amount (see `dayCountsTowardAmount`).
 */
export function dayCountsTowardDays(state: WorkUnitStateValue): boolean {
	return (
		state === 'worked' ||
		state === 'worked_without_approval' ||
		state === 'invoiced' ||
		state === 'paid' ||
		state === 'disputed' ||
		state === 'unbillable'
	);
}

/** Whether a day in `state` counts toward the month calendar's amount
 * total: the same set as `dayCountsTowardDays`, minus `unbillable` —
 * by definition worth nothing. */
export function dayCountsTowardAmount(state: WorkUnitStateValue): boolean {
	return dayCountsTowardDays(state) && state !== 'unbillable';
}

/** Priority order for picking one glyph to represent a date that carries
 * more than one day (rare, but the schema allows one day per contract per
 * date rather than one day per date overall): the risk state always wins,
 * because it is the single most valuable signal in the product, followed
 * by the states that still need a human decision. Lower index = shown
 * first. */
const ATTENTION_ORDER: readonly WorkUnitStateValue[] = [
	'worked_without_approval',
	'disputed',
	'proposed',
	'approved',
	'worked',
	'invoiced',
	'unbillable',
	'paid',
	'rejected',
	'revoked'
];

/** The state to lead with when a single calendar cell carries several
 * days — see `ATTENTION_ORDER`. */
export function mostAttentionNeedingState(
	states: readonly WorkUnitStateValue[]
): WorkUnitStateValue {
	return [...states].sort((a, b) => ATTENTION_ORDER.indexOf(a) - ATTENTION_ORDER.indexOf(b))[0];
}
