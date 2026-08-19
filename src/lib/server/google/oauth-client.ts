// Which OAuth client the Google API features refresh their token with
// (#348), in one place because two features ask the same question.
//
// A refresh token is bound to the OAuth client that obtained it. Measured
// against the real token endpoint, with a token issued to a different
// client in the same Cloud project:
//
//   refresh with the sign-in client  -> HTTP 401 unauthorized_client
//   refresh with the issuing client  -> 200
//
// So "reuse the sign-in client" is right only when the same client also
// obtained the token, which is what the documented consent flow produces
// and therefore the default. When a token already exists — obtained by
// another tool, for the same account — the alternative to a second consent
// is to name the client it belongs to, which is what the override is for.
//
// No scope appears here either. This resolves *who* is spending a token,
// never *what for*: see `access-token.ts`.

export interface GoogleClientSource {
	readonly GOOGLE_CLIENT_ID?: string;
	readonly GOOGLE_CLIENT_SECRET?: string;
	readonly GOOGLE_API_CLIENT_ID?: string;
	readonly GOOGLE_API_CLIENT_SECRET?: string;
}

export interface GoogleClient {
	readonly clientId: string;
	readonly clientSecret: string;
}

/**
 * The client the API features (Gmail sending, the Drive mirror) should
 * refresh with, or `null` when neither pair is configured — which is not an
 * error on its own, since both features are optional and their own
 * configuration decides whether they are wanted at all.
 *
 * A half-set override throws. It is never a choice: an id without a secret
 * cannot refresh anything, and silently falling back to the sign-in client
 * would produce the `unauthorized_client` above at send time, far from the
 * mistake.
 */
export function resolveGoogleApiClient(source: GoogleClientSource): GoogleClient | null {
	const overrideId = source.GOOGLE_API_CLIENT_ID?.trim();
	const overrideSecret = source.GOOGLE_API_CLIENT_SECRET?.trim();
	if (overrideId || overrideSecret) {
		if (!overrideId || !overrideSecret) {
			throw new Error(
				'GOOGLE_API_CLIENT_ID and GOOGLE_API_CLIENT_SECRET must be set together — a client id without its secret cannot refresh a token.'
			);
		}
		return { clientId: overrideId, clientSecret: overrideSecret };
	}

	const clientId = source.GOOGLE_CLIENT_ID?.trim();
	const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}
