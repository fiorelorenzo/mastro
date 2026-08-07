// The only endpoint in the import pipeline that writes anything (#46,
// #47's "nothing is written until the user confirms"). Each accepted
// proposal is confirmed in its own transaction — one HTTP request is still
// "one action" from the user's side, but one proposal failing (a tax id
// that collided with a client created since the review was computed) does
// not undo everyone else's. `created`/`failed` report exactly what
// happened, per proposal, for the screen's summary.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import type { ClientProposal, ContractProposal } from '$lib/server/import/client-match';
import { confirmClientContractProposal } from '$lib/server/import/confirm';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { RequestHandler } from './$types';

interface ConfirmRequestProposal {
	readonly groupKey: string;
	readonly client: ClientProposal;
	readonly contract: ContractProposal;
}

interface ConfirmRequestBody {
	readonly proposals: readonly ConfirmRequestProposal[];
}

function isConfirmRequestBody(value: unknown): value is ConfirmRequestBody {
	return (
		typeof value === 'object' &&
		value !== null &&
		Array.isArray((value as ConfirmRequestBody).proposals)
	);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return text('Malformed JSON body', { status: 400 });
	}
	if (!isConfirmRequestBody(body)) {
		return text('Expected { proposals: [...] }', { status: 400 });
	}

	const created: { groupKey: string; clientId: string; contractId: string }[] = [];
	const failed: { groupKey: string; message: string }[] = [];

	for (const proposal of body.proposals) {
		try {
			const result = await confirmClientContractProposal(proposal.client, proposal.contract);
			created.push({ groupKey: proposal.groupKey, ...result });
		} catch (error) {
			const message = isPostgresConstraintViolation(error, '23505', 'client_tax_id_unique')
				? m.client_validation_tax_id_duplicate()
				: error instanceof Error
					? error.message
					: String(error);
			failed.push({ groupKey: proposal.groupKey, message });
		}
	}

	return json({ created, failed });
};
