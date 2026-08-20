/**
 * Every reason `generateFattura` (this directory's own server action,
 * `+page.server.ts`) can refuse to generate — resolved once, here, so the
 * disabled button and the action's own checks are reading the same three
 * answers instead of two independent ones that can quietly drift apart.
 *
 * #371: before this existed, the button's `disabled` condition read only
 * `invoicingGaps.length`, the client's own missing fields. The action
 * refuses on two more preconditions it never told the button about — no
 * practice profile, no fiscal pack in force on the invoice's issue date —
 * and `load`'s own `invoicingGaps` computation returned `[]` whenever
 * there was no pack to check the client against, which made the button
 * fully enabled in exactly the state generation was guaranteed to fail
 * in. That is the trap a pure function earns its keep against: one
 * decision, exported and tested, that both `load` (to render) and any
 * future caller can read instead of re-deriving.
 */
import type { ClientInvoicingField } from '$lib/server/fiscal/client-invoicing-gaps';

export type FatturaBlocker =
	| { readonly kind: 'clientFields'; readonly fields: readonly ClientInvoicingField[] }
	| { readonly kind: 'practiceProfile' }
	| { readonly kind: 'fiscalPack' };

export interface FatturaPreconditions {
	/** `clientInvoicingGaps(invoice.contract.client, pack)` — `[]` when
	 *  there is no resolved pack to check against, which is why that case
	 *  is carried separately in `hasFiscalPack` rather than folded in
	 *  here. */
	readonly clientFieldGaps: readonly ClientInvoicingField[];
	readonly hasPracticeProfile: boolean;
	readonly hasFiscalPack: boolean;
}

/**
 * Every blocker `generateFattura` would refuse on, in the order the form
 * shows them: the client's own fields first, since that is the one a
 * reviewer already expects, then the two practice-wide preconditions the
 * action checks after them (`+page.server.ts`'s `generateFattura`, the
 * `if (!practiceProfile)` / `if (!resolvedPack)` pair). Empty means the
 * action would proceed to generation.
 */
export function fatturaBlockers(preconditions: FatturaPreconditions): readonly FatturaBlocker[] {
	const blockers: FatturaBlocker[] = [];
	if (preconditions.clientFieldGaps.length > 0) {
		blockers.push({ kind: 'clientFields', fields: preconditions.clientFieldGaps });
	}
	if (!preconditions.hasPracticeProfile) {
		blockers.push({ kind: 'practiceProfile' });
	}
	if (!preconditions.hasFiscalPack) {
		blockers.push({ kind: 'fiscalPack' });
	}
	return blockers;
}
