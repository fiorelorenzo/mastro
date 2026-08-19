// #348: which client spends a refresh token. Pure, so it is exercised
// against fabricated environments rather than the real one.

import { expect, test } from 'vitest';
import { resolveGoogleApiClient } from './oauth-client';

const SIGN_IN = {
	GOOGLE_CLIENT_ID: 'sign-in-id',
	GOOGLE_CLIENT_SECRET: 'sign-in-secret'
};

test('with no override, the sign-in client is used — the behaviour before this change', () => {
	expect(resolveGoogleApiClient(SIGN_IN)).toEqual({
		clientId: 'sign-in-id',
		clientSecret: 'sign-in-secret'
	});
});

/*
 * The case this exists for. A refresh token is bound to the client that
 * obtained it: refreshing one issued elsewhere with the sign-in client
 * answers `401 unauthorized_client`, measured against the real token
 * endpoint. So when a token already exists, naming its client is the
 * alternative to arranging a second consent.
 */
test('the override wins, so a token issued by another client can be spent', () => {
	expect(
		resolveGoogleApiClient({
			...SIGN_IN,
			GOOGLE_API_CLIENT_ID: 'issuing-id',
			GOOGLE_API_CLIENT_SECRET: 'issuing-secret'
		})
	).toEqual({ clientId: 'issuing-id', clientSecret: 'issuing-secret' });
});

test('the override works with no sign-in client configured at all', () => {
	expect(
		resolveGoogleApiClient({
			GOOGLE_API_CLIENT_ID: 'issuing-id',
			GOOGLE_API_CLIENT_SECRET: 'issuing-secret'
		})
	).toEqual({ clientId: 'issuing-id', clientSecret: 'issuing-secret' });
});

/*
 * Falling back would move the failure from configuration time to send time,
 * where it arrives as `unauthorized_client` from Google and looks like a
 * credential problem rather than a missing variable.
 */
test('a half-set override is refused rather than silently ignored', () => {
	expect(() => resolveGoogleApiClient({ ...SIGN_IN, GOOGLE_API_CLIENT_ID: 'issuing-id' })).toThrow(
		/must be set together/
	);
	expect(() =>
		resolveGoogleApiClient({ ...SIGN_IN, GOOGLE_API_CLIENT_SECRET: 'issuing-secret' })
	).toThrow(/must be set together/);
});

test('nothing configured is null, not an error: both features are optional', () => {
	expect(resolveGoogleApiClient({})).toBeNull();
	expect(resolveGoogleApiClient({ GOOGLE_CLIENT_ID: 'sign-in-id' })).toBeNull();
});

test('whitespace is not configuration', () => {
	expect(
		resolveGoogleApiClient({
			...SIGN_IN,
			GOOGLE_API_CLIENT_ID: '  ',
			GOOGLE_API_CLIENT_SECRET: '  '
		})
	).toEqual({ clientId: 'sign-in-id', clientSecret: 'sign-in-secret' });
});
