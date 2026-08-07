// Where a document lands in the mirror's own folder structure (#50).
// Kept apart from `mirror-target.ts` on purpose: a `MirrorTarget` only
// knows how to create and write into a path it is handed, never how to
// decide one — that decision is a domain concern (which client, which
// contract) with nothing to do with which provider is on the other end.
//
// Every document `mastro` can mirror today is owned by a contract or an
// approval (`DocumentOwnerType` in `db/schema/document.ts`), both scoped
// to a client, so the only structure reachable right now is
// `/<contracts folder>/<client legal name>/` — one of the two examples
// #50 itself gives (`/Contracts/<client>/`). The other, `/Invoices/<year>/`,
// names a structure for invoice-linked documents, which do not exist as a
// document owner yet (#26 is out of scope here — see the comment on
// `DocumentOwnerType`); `resolveMirrorFolder` takes the client's legal
// name as an explicit argument rather than a whole document/contract
// graph so that whichever caller eventually has an invoice's own client
// at hand can reuse it unchanged.
import type { MirrorFolder } from './mirror-target';

export type MirrorFolderConfig = {
	/** The top-level folder client-scoped documents publish under.
	 * Configurable so a self-hoster whose interface language is Italian,
	 * or who simply prefers a different label, is not stuck with the
	 * English default. */
	readonly contractsFolderName: string;
};

const DEFAULT_CONTRACTS_FOLDER_NAME = 'Contracts';

/** Parses folder structure settings out of a plain env-like object — a
 * pure function so it is exercised directly, the same way
 * `mail/config.ts`'s `readMailConfig` is. Every value is optional: an
 * unset `DRIVE_MIRROR_CONTRACTS_FOLDER` is not a misconfiguration, just
 * the default. */
export function readMirrorFolderConfig(
	source: Record<string, string | undefined>
): MirrorFolderConfig {
	return {
		contractsFolderName:
			source.DRIVE_MIRROR_CONTRACTS_FOLDER?.trim() || DEFAULT_CONTRACTS_FOLDER_NAME
	};
}

/** Where a client-scoped document (every document today) belongs in the
 * mirror — the exact shape a `MirrorTarget.publish` call expects. */
export function resolveMirrorFolder(
	context: { readonly clientLegalName: string },
	config: MirrorFolderConfig
): MirrorFolder {
	return { segments: [config.contractsFolderName, context.clientLegalName] };
}
