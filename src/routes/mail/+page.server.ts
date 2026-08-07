import { listContractsWithClient } from '$lib/server/repositories/contract';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const contracts = await listContractsWithClient();
	return { contracts };
};
