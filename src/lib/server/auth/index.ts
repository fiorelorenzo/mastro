// Better Auth (#51). Google is the only social provider and, as long as
// nothing here adds a `scope` override, its default scope set is exactly
// `openid email profile` (see the `google` provider in
// node_modules/better-auth: it starts from `["email", "profile", "openid"]`
// and only appends more if configured to). Sessions are cookie based;
// Secure/HttpOnly/SameSite=Lax hold in production configuration below.
//
// The mandatory email allowlist (#53) is enforced in databaseHooks: once
// before a user row (and so its linked Google account) is ever written, and
// again before every session is created. Neither hook fires on a session
// refresh (Better Auth extends an existing row's expiry in place instead of
// inserting a new one), so `hooks.server.ts`'s auth guard re-checks the
// allowlist against every request too (#299) — that is what makes removing
// an address take effect immediately for someone already signed in, not
// only on their next sign-in. All three checks throw or act on the same
// message, so the response never discloses whether an account exists.
import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { ALLOWLIST_REJECTION_MESSAGE, isAllowedEmail, parseAllowlist } from './allowlist';

if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');
if (!env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is not set');
if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
if (!env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is not set');

/**
 * Parsed once per process, not per request. `hooks.server.ts` reuses this
 * exact set to re-check an already-established session on every request
 * (#299): Better Auth's databaseHooks below only run when a user or
 * session row is first created, so this is the only place that observes an
 * address being removed from `AUTH_ALLOWED_EMAILS` for someone already
 * signed in.
 */
export const defaultAllowlist = parseAllowlist(env.AUTH_ALLOWED_EMAILS);

/**
 * Builds a Better Auth instance.
 *
 * `overrides` exists so tests can turn on email/password sign-up to
 * exercise the hooks and cookies below without a real Google round trip;
 * production calls this with nothing.
 *
 * `allowlist` defaults to the configured AUTH_ALLOWED_EMAILS, read once at
 * module load. Tests pass an explicit set instead of mutating the process
 * environment, which $env/dynamic/private snapshots at startup and would
 * not observe anyway.
 */
export function createAuth(
	overrides: Partial<BetterAuthOptions> = {},
	allowlist: ReadonlySet<string> = defaultAllowlist
) {
	const { advanced, ...rest } = overrides;
	return betterAuth({
		database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET
			}
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (!isAllowedEmail(user.email, allowlist)) {
							throw new APIError('FORBIDDEN', { message: ALLOWLIST_REJECTION_MESSAGE });
						}
					}
				}
			},
			session: {
				create: {
					before: async (session, context) => {
						const user = await context?.context.internalAdapter.findUserById(session.userId);
						if (!user || !isAllowedEmail(user.email, allowlist)) {
							throw new APIError('FORBIDDEN', { message: ALLOWLIST_REJECTION_MESSAGE });
						}
					}
				}
			}
		},
		advanced: {
			// Let Postgres generate ids the same way every other table does
			// (columns.ts), instead of Better Auth generating its own.
			database: { generateId: false },
			// baseURL is http://localhost in dev, which a Secure cookie would
			// make the browser refuse; !dev is true for build/preview/production.
			useSecureCookies: !dev,
			...advanced
		},
		...rest
	});
}

export const auth = createAuth();
