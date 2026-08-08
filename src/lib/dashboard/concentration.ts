// Presentation helpers for #59's client concentration chart. Pure and
// universal: the figures come from `fiscal/revenue.ts`'s
// `fetchClientRevenueBreakdown` and the reference lines from
// `fiscal/ceiling-status.ts`'s `evaluateActiveCeilings`, both assembled
// server-side in `+page.server.ts`.

import { CATEGORICAL } from '$lib/design';
import type { MinorUnits } from '$lib/money';

export interface ClientShare {
	readonly clientId: string;
	readonly clientName: string;
	readonly amount: MinorUnits;
}

export interface ShareCeilingReference {
	readonly id: string;
	readonly ratio: number;
	/** `null` for a pack-origin, whole-practice cap; a client id for a
	 * contract's own share clause (AGENTS.md invariant 2). */
	readonly clientId: string | null;
	readonly label: Readonly<Record<'en' | 'it', string>>;
	readonly consequence: Readonly<Record<'en' | 'it', string>>;
	readonly crossed: boolean;
}

/**
 * A stable colour per client, independent of filtering (#59's own
 * acceptance bullet: "assign colour by client identity, not by index in
 * the filtered array"). The categorical slot comes from sorting every
 * client id in the *unfiltered* breakdown, once, by the id itself — a
 * fixed, filter-independent order — never from a position in whatever
 * subset happens to be visible. Returns the `--series-N` custom property
 * name rather than a resolved hex, so the light/dark step is picked up
 * automatically by `palette.css`'s own cascade instead of this needing to
 * track the active scheme. More than the eight categorical slots wraps
 * rather than adding a ninth hue, which the validated palette does not
 * have.
 */
export function assignClientColors(clientIds: readonly string[]): ReadonlyMap<string, string> {
	const sorted = [...clientIds].sort();
	return new Map(
		sorted.map((clientId, index) => [
			clientId,
			`var(--series-${CATEGORICAL[index % CATEGORICAL.length].slot})`
		])
	);
}
