import { listClients } from '$lib/server/repositories/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { clients: await listClients() };
};
