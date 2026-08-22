import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { readDocumentBytes } from '$lib/server/repositories/document';
import { buildDisputeBundle } from '$lib/server/repositories/dispute-bundle';
import { renderDisputeBundleZip } from '$lib/server/dispute-bundle/zip';
import type { RequestHandler } from './$types';

/**
 * #214's evidence bundle, produced in one action: `summary.txt` (every
 * field the on-screen page shows) plus the archived original itself,
 * under its own file name — invariant 4, the whole reason this is a zip
 * and not a PDF of extracted fields. Same auth gate as `/documents/[id]`
 * (not on the public list, `hooks.server.ts` requires a session), and the
 * same `no-store` reasoning: this is evidence, never cached.
 */
export const GET: RequestHandler = async ({ params }) => {
	const bundle = await buildDisputeBundle(params.id);
	if (!bundle) error(404, m.day_detail_not_found());

	const documentBytes = bundle.document ? await readDocumentBytes(bundle.document) : null;
	const zip = renderDisputeBundleZip(bundle, documentBytes, bundle.contract.templateLanguage);

	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="dispute-evidence-${bundle.date}.zip"`,
			'cache-control': 'private, no-store'
		}
	});
};
