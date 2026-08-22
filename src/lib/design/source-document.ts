/**
 * `SourceDocument` bindings — a label for each `document.provenance` value
 * (#215). Duplicated from `documentProvenance` in
 * `$lib/server/db/schema/document.ts` rather than imported, the same
 * reason `day-state-badge.ts` duplicates `work_unit_state`: this module
 * ships to the client and `$lib/server` cannot be bundled into it.
 *
 * `Record<Provenance, X>` rather than a `switch`, the same exhaustiveness
 * argument `day-state-badge.ts` makes: a fifth provenance added to the
 * enum without a row here is a missing-property compile error, not a
 * silently blank label on screen. `X` is the message *function*, not its
 * called-once result, so the lookup happens at render time, against the
 * request's locale, rather than being frozen at import time (#422 — see
 * `day-state-badge.ts` for the sibling bug this mirrors).
 */

import * as m from '$lib/paraglide/messages';

export const DOCUMENT_PROVENANCES = ['folder_import', 'mail', 'upload', 'generated'] as const;

export type DocumentProvenanceValue = (typeof DOCUMENT_PROVENANCES)[number];

const DOCUMENT_PROVENANCE_LABEL: Readonly<Record<DocumentProvenanceValue, () => string>> = {
	folder_import: m.source_document_kind_folder_import,
	mail: m.source_document_kind_mail,
	upload: m.source_document_kind_upload,
	generated: m.source_document_kind_generated
};

/** What kind of document this is, in prose — shown next to the file name
 *  and the archive date, the three facts #215's brief names. */
export function documentProvenanceLabel(provenance: DocumentProvenanceValue): string {
	return DOCUMENT_PROVENANCE_LABEL[provenance]();
}
