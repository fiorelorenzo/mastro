/**
 * Reading a proposal's own `proposedFields` well enough to describe it in
 * the queue, without trusting it.
 *
 * `proposedFields` is untyped JSONB written by an extraction, so every read
 * here is defensive: a row these cannot make sense of shows a generic
 * label, and the queue still opens. That matters more than it sounds —
 * the review queue is one page listing every pending proposal, so one
 * unreadable row taking an exception would take the whole screen with it.
 *
 * Route-local rather than in `$lib`: nothing else needs these, and they
 * live here for the same reason `proposal-status.ts` does — a sibling
 * module the test suite covers, with the route file left to wiring.
 */

/** The `work_unit` shape a day proposal carries. */
export function workUnitFields(
	fields: Record<string, unknown>
): { date: string; quantity: number; scope: string } | null {
	const { date, quantity, scope } = fields;
	if (typeof date !== 'string' || typeof quantity !== 'number' || typeof scope !== 'string') {
		return null;
	}
	return { date, quantity, scope };
}

/**
 * What a first-intake `'contract'` proposal is about: the counterparty and
 * the agreement's own title.
 *
 * A contract proposal has no date and no quantity, so the queue used to
 * describe it with the two placeholders and the separator it puts between
 * a day's date and its quantity — literally `— — —`, which is what a
 * reviewer saw for the only proposal on the screen.
 */
export function contractFields(
	fields: Record<string, unknown>
): { clientLegalName: string; title: string } | null {
	const { client, contract } = fields;
	if (typeof client !== 'object' || client === null) return null;
	if (typeof contract !== 'object' || contract === null) return null;
	if (!('legalName' in client) || !('title' in contract)) return null;
	const { legalName } = client;
	const { title } = contract;
	if (typeof legalName !== 'string' || typeof title !== 'string') return null;
	if (legalName.trim() === '' || title.trim() === '') return null;
	return { clientLegalName: legalName, title };
}
