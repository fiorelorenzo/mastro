import { json } from '@sveltejs/kit';
import { listWorkUnitsForContractOnDate } from '$lib/server/repositories/work-unit';
import type { RequestHandler } from './$types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The days this contract already holds for this date (#417).
 *
 * `/day/new`'s date is a client-side input, so whether a day is already
 * recorded is a question about a pair the page only learns after it loads.
 * One small read per change answers it, in the shape
 * `mail/poll-progress/+server.ts` already uses (#405), rather than shipping
 * every recorded day to the browser to filter there.
 *
 * A GET inside the route tree, so it inherits the session `hooks.server.ts`
 * requires for `/day` and needs no guard of its own — `route-guard.ts` is
 * deny-by-default (invariant 6) and this is deliberately not on its public
 * list. It answers about one contract's billable days.
 *
 * Only what the form has to say out loud: the quantity, the state, and
 * whether the day already rests on written approval. Not the notes, not the
 * invoice line - a warning that is about to be read in a second on a phone
 * is not a place to put a record dump.
 */
export const GET: RequestHandler = async ({ url }) => {
	const contractId = url.searchParams.get('contract') ?? '';
	const date = url.searchParams.get('date') ?? '';
	// A missing or malformed pair is an empty answer, not an error: the page
	// asks on every change, including the moment before a contract is chosen,
	// and a 400 there would be noise in the console for a question that has
	// no answer yet rather than a wrong one.
	if (!contractId || !ISO_DATE.test(date)) return json({ days: [] });

	const days = await listWorkUnitsForContractOnDate(contractId, date);
	return json(
		{
			days: days.map((day) => ({
				id: day.id,
				quantity: Number(day.quantity),
				state: day.state,
				scope: day.scope,
				approved: day.approvalId !== null
			}))
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
