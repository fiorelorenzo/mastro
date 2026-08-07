import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getContract } from '$lib/server/repositories/contract';
import { buildRegister } from '$lib/server/repositories/register';
import type { PageServerLoad } from './$types';

function currentMonthRange(): { from: string; to: string } {
	const now = new Date();
	const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
	return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const load: PageServerLoad = async ({ params, url }) => {
	const contract = await getContract(params.id);
	if (!contract) error(404, m.register_contract_not_found());

	const defaults = currentMonthRange();
	const from = url.searchParams.get('from') || defaults.from;
	const to = url.searchParams.get('to') || defaults.to;

	const register = await buildRegister(params.id, from, to);
	return { contract, register, from, to };
};
