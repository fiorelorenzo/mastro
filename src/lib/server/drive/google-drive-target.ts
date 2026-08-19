// The real `MirrorTarget` (#50): Google Drive, over the plain REST API
// (no `googleapis` dependency — three endpoints, called with `fetch`, do
// not earn a 6MB client library). Written against Drive v3's documented
// behaviour; this project has no Google credentials and no way to get
// any (see AGENTS.md and docs/self-hosting.md), so this module cannot be
// exercised against the real API. `google-drive-target.test.ts` proves
// the request shapes — method, URL, body, and, just as importantly, that
// no request here is ever a read of file content — against a fake
// `fetch`; nothing here has been run against Drive itself. A human with
// a Google account is the only thing that can close that gap.
//
// **Scope.** Every request in this file authenticates with a token
// obtained for the `drive.file` scope (AGENTS.md: "neither sensitive nor
// restricted, and the correct privilege anyway since mastro only touches
// files it created"). This module never requests a scope itself — it
// only spends an already-issued refresh token — so there is no `scope`
// parameter anywhere in `GoogleDriveTargetConfig` or in any function
// below for a future change to widen: the refresh token's scope is fixed
// at the moment a human authorises it (docs/self-hosting.md section 4),
// not by anything this code chooses at runtime.
//
// **Nothing is read back.** `MirrorTarget` (see `mirror-target.ts`) has
// one method, `publish`, and every request this file makes is one of
// exactly three kinds: refresh a token, find-or-create a folder by name
// (`files.list`/`files.create`, metadata only — `fields=id`, never
// `alt=media`), or upload a file (`files.create` with a body). None of
// them is `files.get`, none of them requests `alt=media` or exports
// content, and there is no code path that could turn a response into
// document bytes even by accident — every response here is read only for
// an `id`.
import { randomUUID } from 'node:crypto';
import { createGoogleAccessTokenCache, type FetchLike } from '$lib/server/google/access-token';
import type { MirrorPublishInput, MirrorPublishResult, MirrorTarget } from './mirror-target';

export type GoogleDriveTargetConfig = {
	/** The same OAuth client already configured for sign-in
	 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, docs/self-hosting.md
	 * section 1) — one Google Cloud project, one OAuth consent screen,
	 * reused for a second, narrower purpose rather than asking a
	 * self-hoster to create a second project for one more scope. */
	readonly clientId: string;
	readonly clientSecret: string;
	/** Obtained once by a human, outside this application — see
	 * docs/self-hosting.md section 4. Not something this code can obtain
	 * for itself: the authorization step is a live browser round trip
	 * with a Google account behind it. */
	readonly refreshToken: string;
};

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/** Drive's query language treats `'` and `\` specially inside a string
 * literal; a client or folder name containing either would otherwise
 * break the query or, worse, let one string literal escape into the next
 * clause. */
function escapeDriveQueryValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Finds the folder named `name` directly under `parentId`, creating it
 * if it does not exist, and returns its id either way. `drive.file`
 * scopes `files.list` to files and folders this application itself
 * created (or the user opened with it) — never the user's whole Drive —
 * so this lookup can never find, and so can never collide with, a folder
 * of the same name the human made by hand elsewhere in their Drive.
 */
async function findOrCreateFolder(
	name: string,
	parentId: string,
	accessToken: string,
	fetchImpl: FetchLike
): Promise<string> {
	const query = [
		`name = '${escapeDriveQueryValue(name)}'`,
		`mimeType = '${FOLDER_MIME_TYPE}'`,
		`'${parentId}' in parents`,
		'trashed = false'
	].join(' and ');
	const listUrl = `${FILES_ENDPOINT}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(
		'files(id)'
	)}&spaces=drive&pageSize=1`;
	const listResponse = await fetchImpl(listUrl, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!listResponse.ok) {
		throw new Error(
			`Drive folder lookup for "${name}" failed: ${listResponse.status} ${await listResponse.text()}`
		);
	}
	const listBody = (await listResponse.json()) as { files: { id: string }[] };
	const existing = listBody.files[0];
	if (existing) return existing.id;

	const createResponse = await fetchImpl(`${FILES_ENDPOINT}?fields=id`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] })
	});
	if (!createResponse.ok) {
		throw new Error(
			`Drive folder creation for "${name}" failed: ${createResponse.status} ${await createResponse.text()}`
		);
	}
	const createBody = (await createResponse.json()) as { id: string };
	return createBody.id;
}

/** Drive's "simple and multipart upload" body shape: two MIME parts
 * separated by `boundary`, the first the JSON metadata, the second the
 * raw bytes under their real content type. Built by hand rather than
 * pulled in from a multipart library because it is two parts, always in
 * this order, never streamed — not worth a dependency. Returns a plain
 * `Uint8Array`, not a Node `Buffer`: `fetch`'s `BodyInit` accepts the
 * former directly, and the latter needs its bytes copied out into one
 * regardless to concatenate the three parts, so nothing is lost by
 * working in `Uint8Array` throughout. */
function buildMultipartUploadBody(
	metadata: unknown,
	mime: string,
	bytes: Uint8Array,
	boundary: string
): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const head = encoder.encode(
		`--${boundary}\r\n` +
			'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
			`${JSON.stringify(metadata)}\r\n` +
			`--${boundary}\r\n` +
			`Content-Type: ${mime}\r\n\r\n`
	);
	const tail = encoder.encode(`\r\n--${boundary}--`);
	const body = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
	body.set(head, 0);
	body.set(bytes, head.byteLength);
	body.set(tail, head.byteLength + bytes.byteLength);
	return body;
}

async function uploadFile(
	input: MirrorPublishInput,
	parentId: string,
	accessToken: string,
	fetchImpl: FetchLike
): Promise<string> {
	const boundary = `mastro-drive-mirror-${randomUUID()}`;
	const body = buildMultipartUploadBody(
		{ name: input.fileName, parents: [parentId] },
		input.mime,
		input.bytes,
		boundary
	);
	const response = await fetchImpl(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': `multipart/related; boundary=${boundary}`
		},
		body
	});
	if (!response.ok) {
		throw new Error(
			`Drive upload of "${input.fileName}" failed: ${response.status} ${await response.text()}`
		);
	}
	const created = (await response.json()) as { id: string };
	return created.id;
}

/**
 * `fetchImpl` defaults to the global `fetch` and exists so tests can
 * substitute a fake one — the same reason `blob-store.ts` takes its
 * storage root explicitly instead of reading configuration itself.
 */
export function createGoogleDriveMirrorTarget(
	config: GoogleDriveTargetConfig,
	fetchImpl: FetchLike = fetch
): MirrorTarget {
	// One shared implementation of the refresh-token exchange, since #345
	// gave the Gmail sender the same need; see
	// `server/google/access-token.ts` for why no scope is nameable there.
	const getAccessToken = createGoogleAccessTokenCache(config, 'Drive', fetchImpl);

	return {
		async publish(input: MirrorPublishInput): Promise<MirrorPublishResult> {
			const accessToken = await getAccessToken();
			let parentId = 'root';
			for (const segment of input.folder.segments) {
				parentId = await findOrCreateFolder(segment, parentId, accessToken, fetchImpl);
			}
			const remoteFileId = await uploadFile(input, parentId, accessToken, fetchImpl);
			return { remoteFileId };
		}
	};
}
