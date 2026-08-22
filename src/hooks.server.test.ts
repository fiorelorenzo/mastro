// Exercises `createHandleAuth` against the real Better Auth instance and the
// real database, the same way `auth/index.ts`'s `auth.test.ts` exercises
// `createAuth`: sign-up with email/password stands in for Google-initiated
// account creation, reaching the exact same session machinery. `resolve` is
// a stub Response identity check, never a real SvelteKit render — this file
// is about the auth guard's decision, not the rest of the pipeline.
//
// A `RequestEvent` is faked with only the fields `createHandleAuth` reads
// (`route.id`, `request.headers`, `url`, `locals`): building a full one
// would require the SvelteKit router, which is not under test here.
import { isRedirect, type Handle } from '@sveltejs/kit';
import { gte, inArray } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { auth, createAuth } from '$lib/server/auth';
import { client, db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { createHandleAuth, handleSecurityHeaders } from './hooks.server';

const startedAt = new Date();
const createdEmails: string[] = [];

afterAll(async () => {
	// Same cleanup shape as auth.test.ts: scoped deletes, never an
	// unqualified one, since this database is shared with a running app.
	if (createdEmails.length > 0) {
		await db.delete(schema.user).where(inArray(schema.user.email, createdEmails));
	}
	await db.delete(schema.verification).where(gte(schema.verification.createdAt, startedAt));
	await client.end();
});

type HandleInput = Parameters<Handle>[0];

const RESOLVED = new Response('resolved', { status: 200 });
const resolve: HandleInput['resolve'] = async () => RESOLVED;

function requestEvent(routeId: string | null, headers: Headers): HandleInput['event'] {
	const url = new URL('https://mastro.test/probe');
	return {
		route: { id: routeId },
		request: new Request(url, { headers }),
		url,
		locals: { session: null, user: null }
	} as unknown as HandleInput['event'];
}

async function signUpAndGetCookie(
	testAuth: Pick<typeof auth, 'api'>,
	email: string
): Promise<string> {
	const response = await testAuth.api.signUpEmail({
		body: { name: 'Test User', email, password: 'correct horse battery staple' },
		asResponse: true
	});
	return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

test('an allowed email passes: the request resolves and locals carry the session', async () => {
	const email = `allowed-${crypto.randomUUID()}@example.com`;
	createdEmails.push(email);
	const testAuth = createAuth({ emailAndPassword: { enabled: true } }, new Set([email]));
	const cookie = await signUpAndGetCookie(testAuth, email);

	const handleAuth = createHandleAuth(testAuth, new Set([email]));
	const event = requestEvent('/documents/[id=uuid]', new Headers({ cookie }));
	const response = await handleAuth({ event, resolve });

	expect(response).toBe(RESOLVED);
	expect(event.locals.user?.email).toBe(email);
	expect(event.locals.session).not.toBeNull();
});

test('removing one address from a multi-address allowlist rejects only that address, and its session is gone on a second request rather than merely ignored', async () => {
	const removedEmail = `removed-${crypto.randomUUID()}@example.com`;
	const keptEmail = `kept-${crypto.randomUUID()}@example.com`;
	createdEmails.push(removedEmail, keptEmail);
	const testAuth = createAuth(
		{ emailAndPassword: { enabled: true } },
		new Set([removedEmail, keptEmail])
	);
	const removedCookie = await signUpAndGetCookie(testAuth, removedEmail);
	const keptCookie = await signUpAndGetCookie(testAuth, keptEmail);

	// removedEmail is off the list; keptEmail is still on it.
	const narrowedHandleAuth = createHandleAuth(testAuth, new Set([keptEmail]));

	const removedResponse = await narrowedHandleAuth({
		event: requestEvent('/documents/[id=uuid]', new Headers({ cookie: removedCookie })),
		resolve
	});
	expect(removedResponse.status).toBe(401);

	const keptResponse = await narrowedHandleAuth({
		event: requestEvent('/documents/[id=uuid]', new Headers({ cookie: keptCookie })),
		resolve
	});
	expect(keptResponse).toBe(RESOLVED);

	// Not merely ignored by the narrower allowlist: the session row is
	// actually gone, so even the original, wider allowlist that used to
	// admit removedEmail no longer finds a session to check at all.
	const originalHandleAuth = createHandleAuth(testAuth, new Set([removedEmail, keptEmail]));
	const secondAttempt = await originalHandleAuth({
		event: requestEvent('/documents/[id=uuid]', new Headers({ cookie: removedCookie })),
		resolve
	});
	expect(secondAttempt.status).toBe(401);

	const rawSession = await testAuth.api.getSession({
		headers: new Headers({ cookie: removedCookie })
	});
	expect(rawSession).toBeNull();
});

test('emptying the allowlist rejects a previously valid session', async () => {
	const email = `evicted-${crypto.randomUUID()}@example.com`;
	createdEmails.push(email);
	const testAuth = createAuth({ emailAndPassword: { enabled: true } }, new Set([email]));
	const cookie = await signUpAndGetCookie(testAuth, email);

	// Sanity check: the session is genuinely valid before the list empties.
	const beforeResponse = await createHandleAuth(
		testAuth,
		new Set([email])
	)({
		event: requestEvent('/documents/[id=uuid]', new Headers({ cookie })),
		resolve
	});
	expect(beforeResponse).toBe(RESOLVED);

	const afterResponse = await createHandleAuth(
		testAuth,
		new Set()
	)({
		event: requestEvent('/documents/[id=uuid]', new Headers({ cookie })),
		resolve
	});
	expect(afterResponse.status).toBe(401);
});

test('a public route resolves with no session, unaffected by the allowlist', async () => {
	const handleAuth = createHandleAuth();
	const event = requestEvent('/sign-in', new Headers());
	const response = await handleAuth({ event, resolve });

	expect(response).toBe(RESOLVED);
	expect(event.locals.session).toBeNull();
	expect(event.locals.user).toBeNull();
});

test('a rejected session on a page route redirects to sign-in instead of returning a bare 401', async () => {
	const email = `page-${crypto.randomUUID()}@example.com`;
	createdEmails.push(email);
	const testAuth = createAuth({ emailAndPassword: { enabled: true } }, new Set([email]));
	const cookie = await signUpAndGetCookie(testAuth, email);

	const handleAuth = createHandleAuth(testAuth, new Set());
	const event = requestEvent('/', new Headers({ cookie }));

	await expect(handleAuth({ event, resolve })).rejects.toSatisfy(
		(error) => isRedirect(error) && error.status === 303 && error.location.startsWith('/sign-in')
	);
});

test('handleSecurityHeaders adds nosniff and a Content-Security-Policy to a response that has neither', async () => {
	const event = requestEvent('/', new Headers());
	const plainResolve: HandleInput['resolve'] = async () => new Response('body', { status: 200 });

	const response = await handleSecurityHeaders({ event, resolve: plainResolve });

	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	const csp = response.headers.get('content-security-policy');
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("frame-ancestors 'none'");
});

test('handleSecurityHeaders adds nosniff but never overwrites a Content-Security-Policy the response already carries', async () => {
	const event = requestEvent('/', new Headers());
	const pageResolve: HandleInput['resolve'] = async () =>
		new Response('<html></html>', {
			status: 200,
			headers: { 'content-security-policy': "default-src 'self'; script-src 'nonce-abc123'" }
		});

	const response = await handleSecurityHeaders({ event, resolve: pageResolve });

	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('content-security-policy')).toBe(
		"default-src 'self'; script-src 'nonce-abc123'"
	);
});

test('handleSecurityHeaders adds its headers to a non-2xx response too, e.g. the guard-rejected 401', async () => {
	const event = requestEvent('/api/whatever', new Headers());
	const rejectResolve: HandleInput['resolve'] = async () => new Response(null, { status: 401 });

	const response = await handleSecurityHeaders({ event, resolve: rejectResolve });

	expect(response.status).toBe(401);
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('content-security-policy')).not.toBeNull();
});
