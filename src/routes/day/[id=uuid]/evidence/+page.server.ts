import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { calendarCrumbs } from '$lib/nav/crumbs';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import { buildDisputeBundle } from '$lib/server/repositories/dispute-bundle';
import type { PageServerLoad } from './$types';

/**
 * #214's evidence bundle, on screen: everything an argument needs about
 * one day, assembled in the one query `buildDisputeBundle` runs — the
 * approval and its verbatim excerpt, the archived original, the register
 * entry for the month the day falls in, every clause note on the
 * contract, and the invoice line it landed on. Reachable for any day that
 * has ever been through `disputed`, not gated on the day's *current*
 * state, so the record stays readable after a dispute is resolved.
 */
export const load: PageServerLoad = async ({ params }) => {
	const bundle = await buildDisputeBundle(params.id);
	if (!bundle) error(404, m.day_detail_not_found());

	const crumbs = calendarCrumbs();

	return {
		bundle: {
			workUnitId: bundle.workUnitId,
			date: bundle.date,
			quantity: bundle.quantity,
			scope: bundle.scope,
			state: bundle.state,
			contract: { title: bundle.contract.title, clientName: bundle.contract.clientName },
			approval: bundle.approval
				? {
						channel: bundle.approval.channel,
						sender: bundle.approval.sender,
						receivedAt: bundle.approval.receivedAt.toISOString(),
						messageId: bundle.approval.messageId,
						excerpt: bundle.approval.excerpt
					}
				: null,
			document: bundle.document ? toSourceDocumentValue(bundle.document) : null,
			register: {
				from: bundle.register.from,
				to: bundle.register.to,
				entry: bundle.register.entry,
				totalQuantity: bundle.register.totalQuantity
			},
			clauseNotes: bundle.clauseNotes,
			invoiceLine: bundle.invoiceLine
		},
		crumbs
	};
};
