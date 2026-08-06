// Better Auth's own routes: Google sign-in, its OAuth callback, session
// lookup, sign-out. Public by default (see route-guard.ts) because this is
// the entry point to authentication itself.
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => auth.handler(request);
export const POST: RequestHandler = ({ request }) => auth.handler(request);
