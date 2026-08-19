// Spending a Google refresh token, in one place (#345). Two features need
// an access token now — the Drive mirror (`drive/google-drive-target.ts`,
// `drive.file`) and the Gmail sender (`mail/gmail-api.ts`, `gmail.send`) —
// and a second copy of this exchange would be a second place to get the
// early-refresh margin, the error message, or the cache lifetime subtly
// different.
//
// **This module never names a scope, and there is nowhere to put one.** A
// refresh token's scope is fixed at the moment a human authorises it (see
// docs/self-hosting.md section 4); the token exchange below cannot widen
// it, and no caller can ask it to. That is deliberate: the whole reason
// sending goes through `gmail.send` and the mirror through `drive.file` is
// that neither is a restricted scope, and a `scope` parameter here would
// be the one place a future change could quietly undo that.
//
// No client library. This is one form-encoded POST; `googleapis` is 6MB
// and a dependency the runner image would have to carry, for this.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** The three fields any caller needs to spend a refresh token: the OAuth
 * client it was issued to, and the token itself. */
export interface GoogleOAuthCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly refreshToken: string;
}

export interface GoogleAccessToken {
	readonly value: string;
	/** Epoch milliseconds, already pulled a minute earlier than Google's
	 * own expiry so a token handed out just before the boundary cannot
	 * expire mid-call. */
	readonly expiresAt: number;
}

export type FetchLike = typeof fetch;

/**
 * Exchanges `credentials`' refresh token for an access token. `purpose`
 * appears only in the error message, so a failure says which feature's
 * token could not be refreshed rather than leaving two identical messages
 * to tell apart in a log.
 */
export async function requestGoogleAccessToken(
	credentials: GoogleOAuthCredentials,
	purpose: string,
	fetchImpl: FetchLike = fetch
): Promise<GoogleAccessToken> {
	const response = await fetchImpl(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			refresh_token: credentials.refreshToken,
			grant_type: 'refresh_token'
		})
	});
	if (!response.ok) {
		// The body of a failed token exchange is Google's own error JSON
		// (`invalid_grant` and friends) and carries no secret of ours: the
		// request sent the client secret, the response does not echo it.
		throw new Error(`${purpose} token refresh failed: ${response.status} ${await response.text()}`);
	}
	const body: unknown = await response.json();
	if (
		typeof body !== 'object' ||
		body === null ||
		!('access_token' in body) ||
		typeof body.access_token !== 'string' ||
		!('expires_in' in body) ||
		typeof body.expires_in !== 'number'
	) {
		throw new Error(`${purpose} token refresh returned no usable access token`);
	}
	return {
		value: body.access_token,
		expiresAt: Date.now() + (body.expires_in - 60) * 1000
	};
}

/**
 * A one-token cache around {@link requestGoogleAccessToken}: hands back the
 * token it already has until a minute before Google expires it, then
 * refreshes once. Each feature holds its own instance, so the Drive
 * mirror's token and the Gmail sender's are never confused for each other
 * even when both are issued to the same OAuth client.
 */
export function createGoogleAccessTokenCache(
	credentials: GoogleOAuthCredentials,
	purpose: string,
	fetchImpl: FetchLike = fetch
): () => Promise<string> {
	let cached: GoogleAccessToken | null = null;
	return async () => {
		if (cached && cached.expiresAt > Date.now()) return cached.value;
		cached = await requestGoogleAccessToken(credentials, purpose, fetchImpl);
		return cached.value;
	};
}
