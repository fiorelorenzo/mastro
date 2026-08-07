import { getContract } from '$lib/server/repositories/contract';
import { listProposals } from '$lib/server/repositories/proposal';
import type { ProposalStatusValue } from './proposal-status';
import type { PageServerLoad } from './$types';

// The review queue (#83): pending by default — the work waiting on a human
// — with `?status=accepted`/`?status=rejected` for the decided history the
// diff between proposed and accepted actually lives in.
export const load: PageServerLoad = async ({ url }) => {
	const statusParam = url.searchParams.get('status');
	const status: ProposalStatusValue =
		statusParam === 'accepted' || statusParam === 'rejected' ? statusParam : 'pending';
	const rows = await listProposals(status);

	const contractIds = [...new Set(rows.map((row) => row.contractId))];
	const contracts = await Promise.all(contractIds.map((id) => getContract(id)));
	const contractTitleById = new Map(
		contracts.filter((c) => c !== undefined).map((c) => [c.id, c.title])
	);

	return {
		status,
		rows: rows.map((row) => ({
			id: row.id,
			targetType: row.targetType,
			contractTitle: contractTitleById.get(row.contractId) ?? row.contractId,
			excerpt: row.excerpt,
			confidence: row.confidence,
			createdAt: row.createdAt.toISOString()
		}))
	};
};
