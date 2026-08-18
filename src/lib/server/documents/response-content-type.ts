// Backing `src/routes/documents/[id]/+server.ts` (#303), which the
// SvelteKit route naming convention won't let a test import directly
// (`+server.test.ts` collides with the `+`-prefixed reserved file
// convention, same reason `health-checks.ts` exists) — so the allowlist
// decision lives here as a plain, DB-free function, and the route stays a
// thin wrapper.
//
// The stored mime (`document.mime`) is whatever the uploading browser's
// multipart part header said it was (`file.type`, set at upload in
// `src/routes/approvals/new/+page.server.ts` and
// `src/routes/invoices/[id]/+page.server.ts`) — evidence, kept verbatim in
// the row, untouched here. What this function controls is only what the
// *response* is allowed to claim: a browser told `content-type: text/html`
// runs an uploaded file as first-party script, in the session of whoever
// opened it, on the one origin that matters. A narrow inline-safe allowlist
// (PDF, `image/*`, RFC 822 messages — the issue's own wording) passes
// through unchanged; everything else, HTML included, downgrades to
// `application/octet-stream`, which every browser downloads rather than
// renders, `Content-Disposition: attachment` notwithstanding.
//
// `image/svg+xml` matches `image/*` and is deliberately let through:
// SVG can carry a `<script>` too, but the attachment disposition above is
// what actually stops same-origin execution against a session cookie (the
// concrete attack in #303's issue body) — a forced download never
// executes on this origin at all, regardless of the claimed type. Once
// downloaded to disk and opened by hand it runs in a `file://` origin,
// which is not this app's origin and holds no session cookie to steal.
const INLINE_SAFE_MIME_TYPES: Record<string, true> = {
	'application/pdf': true,
	'message/rfc822': true
};

const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/** The `Content-Type` `/documents/[id]` is allowed to claim for a document
 * stored with `storedMime`. Normalises to lowercase: MIME types are
 * case-insensitive, and comparing case-insensitively is what keeps
 * `IMAGE/PNG` from slipping past the allowlist by casing alone. */
export function resolveDownloadContentType(storedMime: string): string {
	const mime = storedMime.trim().toLowerCase();
	if (INLINE_SAFE_MIME_TYPES[mime] || mime.startsWith('image/')) {
		return mime;
	}
	return FALLBACK_CONTENT_TYPE;
}
