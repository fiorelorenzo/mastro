import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getDocument, readDocumentBytes } from '$lib/server/repositories/document';
import type { RequestHandler } from './$types';

/**
 * Serves an archived document back to the person who archived it (#187).
 *
 * Every piece of evidence this product keeps — an approval's proof, an
 * expense receipt, an imported invoice — has been
 * write-only until now: the row names the file and nothing in the app
 * could open it. Invariant 4 says the source document is what counts when
 * a client disputes a day, which is worth very little if the source
 * cannot be read back.
 *
 * Not on the public list, so `hooks.server.ts` requires a session like
 * every other route. `Content-Disposition: attachment` because these are
 * arbitrary uploaded bytes and rendering them inline in the app's own
 * origin would let an uploaded HTML file run as this site.
 */
export const GET: RequestHandler = async ({ params }) => {
	const doc = await getDocument(params.id);
	if (!doc) error(404, m.document_not_found());

	const bytes = await readDocumentBytes(doc);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': doc.mime,
			'content-length': String(doc.size),
			'content-disposition': `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
			// Evidence, behind a session: never in a shared cache, and never
			// in the service worker's data cache either (#140's rule).
			'cache-control': 'private, no-store'
		}
	});
};
