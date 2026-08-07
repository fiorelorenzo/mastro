import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getContract } from '$lib/server/repositories/contract';
import { buildRegister } from '$lib/server/repositories/register';
import { renderRegisterPdf } from '$lib/server/register/pdf';

export async function GET({ params, url }) {
	const contract = await getContract(params.id);
	if (!contract) error(404, m.register_contract_not_found());

	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (!from || !to) error(400, 'from and to query parameters are required');

	const register = await buildRegister(params.id, from, to);
	const pdf = await renderRegisterPdf(register, contract.templateLanguage);
	return new Response(new Uint8Array(pdf), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="day-register-${from}-to-${to}.pdf"`
		}
	});
}
