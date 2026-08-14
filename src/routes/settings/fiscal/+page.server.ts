// #223: the fiscal profile, configured from the interface instead of by
// hand in SQL. Reachable from `/settings`'s own summary row
// (`settings_fiscal_manage_link`); this is the page that actually reads
// and writes `fiscal_profile`.

import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import {
	getCurrentFiscalProfile,
	listFiscalProfiles,
	switchFiscalProfile
} from '$lib/server/repositories/fiscal-profile';
import {
	fiscalPackKey,
	parseFiscalProfileForm
} from '$lib/server/repositories/fiscal-profile-form';
import { settingsCrumbs } from '$lib/nav/crumbs';
import type { CeilingBasis, CeilingMeasure, FiscalPack } from '$lib/server/fiscal/pack';
import type { LabelBundle } from '$lib/server/fiscal/label';
import { defaultRegistry, lookupPack } from '$lib/server/fiscal/registry';
import type { Actions, PageServerLoad } from './$types';

export interface PackSummary {
	readonly key: string;
	readonly displayName: LabelBundle;
	readonly ceilings: readonly {
		readonly id: string;
		readonly label: LabelBundle;
		readonly measure: CeilingMeasure;
		readonly value: number;
		readonly basis: CeilingBasis;
	}[];
}

/** `FiscalPack` narrowed to what the picker and the two ceiling previews
 * (current regime, selected pack) need — never the whole engine type,
 * whose `treatments`/`charges`/`formats` this screen has no use for. */
function packSummary(pack: FiscalPack): PackSummary {
	return {
		key: fiscalPackKey(pack),
		displayName: pack.displayName,
		ceilings: pack.ceilings.map((ceiling) => ({
			id: ceiling.id,
			label: ceiling.label,
			measure: ceiling.measure,
			value: ceiling.value,
			basis: ceiling.basis
		}))
	};
}

export const load: PageServerLoad = async () => {
	const [current, history] = await Promise.all([getCurrentFiscalProfile(), listFiscalProfiles()]);
	const packs = [...defaultRegistry.values()].map(packSummary);

	return {
		current: current
			? {
					validFrom: current.validFrom,
					pack: packSummary(lookupPack(defaultRegistry, current.packId, current.packVersion))
				}
			: null,
		history: history.map((row) => ({
			id: row.id,
			validFrom: row.validFrom,
			validTo: row.validTo,
			displayName: lookupPack(defaultRegistry, row.packId, row.packVersion).displayName
		})),
		packs,
		crumbs: settingsCrumbs()
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const result = parseFiscalProfileForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		try {
			await switchFiscalProfile(result.input);
		} catch (err) {
			if (isPostgresConstraintViolation(err, '23P01', 'fiscal_profile_no_overlap')) {
				// Same shape as the parser's own failure above: a
				// `Record<string, string>` keyed by field name. Annotating it
				// keeps the two branches one type rather than a union the page
				// would have to narrow before it could read `errors.packKey`.
				const errors: Record<string, string> = {
					validFrom: m.settings_fiscal_validation_overlap()
				};
				return fail(400, { errors, values: result.values });
			}
			throw err;
		}

		redirect(303, '/settings/fiscal');
	}
};
