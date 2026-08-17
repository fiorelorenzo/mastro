// Exercises the real Better Auth instance against the real database. What
// this cannot cover is the live Google round trip: there are no Google
// credentials in this environment. Everything downstream of "Google handed
// back a code" is real, including the allowlist hooks and the cookies they
// gate. Sign-up with email and password stands in for Google-initiated
// account creation only for this test: it reaches the exact same
// databaseHooks.user.create.before that Google sign-in reaches, since both
// go through internalAdapter.createUser under the hood. Production never
// enables email and password; see createAuth in ./index.ts.
import { eq, gte, inArray } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client, db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { ALLOWLIST_REJECTION_MESSAGE } from './allowlist';
import { auth, createAuth } from './index';

// Better Auth manages its own writes, so this suite cannot wrap its work in
// the transaction the other database tests roll back. It cleans up instead,
// and the cleanup is scoped to the rows this run created: an unqualified
// DELETE would sign out whoever is using the same database, which is exactly
// what it did to a browser session during the #152 work (#163).
const startedAt = new Date();
const createdEmails: string[] = [];

afterAll(async () => {
	// user cascades to account and session, so those need no delete of their
	// own. The verification rows come from the OAuth state the scope check
	// writes and carry no user, so they go by age instead.
	if (createdEmails.length > 0) {
		await db.delete(schema.user).where(inArray(schema.user.email, createdEmails));
	}
	await db.delete(schema.verification).where(gte(schema.verification.createdAt, startedAt));
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
	createdEmails.push(email);
	// The allowlist has one unrelated address on it, not this one: an empty
	// allowlist would admit nobody for a different reason than the one this
	// test checks.
	const testAuth = createAuth(
		{ emailAndPassword: { enabled: true } },
		new Set(['someone-else@example.com'])
	);

	await expect(
		testAuth.api.signUpEmail({
			body: { name: 'Outsider', email, password: 'correct horse battery staple' }
		})
	).rejects.toMatchObject({ status: 'FORBIDDEN', body: { message: ALLOWLIST_REJECTION_MESSAGE } });

	const userRows = await db.select().from(schema.user).where(eq(schema.user.email, email));
	expect(userRows).toHaveLength(0);
	// Scoped to this email's own user, not a count of the whole `account`
	// table. The table-wide count this used to compare was fragile by the rule
	// `AGENTS.md` states outright — "a query that ... counts a whole table
	// sees the seed's rows too: scope every assertion to the ids the test
	// itself created" — and it broke the moment another test file signed a
	// user up in a parallel worker, which is a real concurrent insert and not
	// a flake to retry.
	const accountRows = await db
		.select()
		.from(schema.account)
		.innerJoin(schema.user, eq(schema.account.userId, schema.user.id))
		.where(eq(schema.user.email, email));
	expect(accountRows).toHaveLength(0);
});

test('an allowlisted address signs up, gets a Secure/HttpOnly/SameSite=Lax cookie in production configuration, and sign-out clears it', async () => {
	const email = `member-${crypto.randomUUID()}@example.com`;
	createdEmails.push(email);
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
