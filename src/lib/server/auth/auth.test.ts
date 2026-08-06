// Exercises the real Better Auth instance against the real database. What
// this cannot cover is the live Google round trip: there are no Google
// credentials in this environment. Everything downstream of "Google handed
// back a code" is real, including the allowlist hooks and the cookies they
// gate. Sign-up with email and password stands in for Google-initiated
// account creation only for this test: it reaches the exact same
// databaseHooks.user.create.before that Google sign-in reaches, since both
// go through internalAdapter.createUser under the hood. Production never
// enables email and password; see createAuth in ./index.ts.
import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client, db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { ALLOWLIST_REJECTION_MESSAGE } from './allowlist';
import { auth, createAuth } from './index';

afterAll(async () => {
	// This suite is the only one writing to Better Auth's tables; clear what
	// it created (an OAuth state row from the scope-check call, plus the
	// user/account/session rows from the sign-up flows below) so the suite
	// leaves nothing behind, in the spirit of the transaction-rollback
	// pattern used elsewhere even though Better Auth manages its own writes.
	await db.delete(schema.verification);
	await db.delete(schema.session);
	await db.delete(schema.account);
	await db.delete(schema.user);
	await client.end();
});

test('the sign-in route requests exactly openid, email and profile from Google, nothing more', async () => {
	const response = await auth.api.signInSocial({
		body: { provider: 'google', callbackURL: '/' },
		asResponse: true
	});
	const location = response.headers.get('location');
	expect(location).toBeTruthy();

	const authorizeURL = new URL(location!);
	expect(authorizeURL.origin + authorizeURL.pathname).toBe(
		'https://accounts.google.com/o/oauth2/v2/auth'
	);
	const scopes = authorizeURL.searchParams.get('scope')?.split(' ');
	expect(new Set(scopes)).toEqual(new Set(['openid', 'email', 'profile']));
});

test('the OAuth callback rejects a state it never issued, without setting a session', async () => {
	const response = await auth.handler(
		new Request(
			'http://localhost:5187/api/auth/callback/google?state=not-a-real-state&code=irrelevant'
		)
	);
	expect(response.status).toBeGreaterThanOrEqual(300);
	expect(response.status).toBeLessThan(400);
	const location = response.headers.get('location');
	expect(location).toBeTruthy();
	expect(new URL(location!).searchParams.get('error')).toBe('state_mismatch');
	expect(response.headers.get('set-cookie')).toBeNull();
});

test('an address outside the allowlist completes account creation and is still rejected, leaving no user or account row behind', async () => {
	const email = `outsider-${crypto.randomUUID()}@example.com`;
	// The allowlist has one unrelated address on it, not this one: an empty
	// allowlist would admit nobody for a different reason than the one this
	// test checks.
	const testAuth = createAuth(
		{ emailAndPassword: { enabled: true } },
		new Set(['someone-else@example.com'])
	);
	const accountCountBefore = (await db.select().from(schema.account)).length;

	await expect(
		testAuth.api.signUpEmail({
			body: { name: 'Outsider', email, password: 'correct horse battery staple' }
		})
	).rejects.toMatchObject({ status: 'FORBIDDEN', body: { message: ALLOWLIST_REJECTION_MESSAGE } });

	const userRows = await db.select().from(schema.user).where(eq(schema.user.email, email));
	expect(userRows).toHaveLength(0);
	const accountCountAfter = (await db.select().from(schema.account)).length;
	expect(accountCountAfter).toBe(accountCountBefore);
});

test('an allowlisted address signs up, gets a Secure/HttpOnly/SameSite=Lax cookie in production configuration, and sign-out clears it', async () => {
	const email = `member-${crypto.randomUUID()}@example.com`;
	const testAuth = createAuth(
		{ emailAndPassword: { enabled: true }, advanced: { useSecureCookies: true } },
		new Set([email])
	);

	const signUpResponse = await testAuth.api.signUpEmail({
		body: { name: 'Member', email, password: 'correct horse battery staple' },
		asResponse: true
	});
	expect(signUpResponse.status).toBe(200);
	const setCookie = signUpResponse.headers.get('set-cookie') ?? '';
	expect(setCookie).toContain('Secure');
	expect(setCookie.toLowerCase()).toContain('httponly');
	expect(setCookie).toContain('SameSite=Lax');

	const sessionCookie = setCookie.split(';')[0];
	const signOutResponse = await testAuth.api.signOut({
		headers: new Headers({ cookie: sessionCookie }),
		asResponse: true
	});
	const clearedCookie = signOutResponse.headers.get('set-cookie') ?? '';
	expect(clearedCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

	const sessionAfterSignOut = await testAuth.api.getSession({
		headers: new Headers({ cookie: sessionCookie })
	});
	expect(sessionAfterSignOut).toBeNull();
});
