// #113: proves, against the real `deploy/Caddyfile` running inside the
// real `caddy:2-alpine` image (`compose.xff-test.yaml`), what Caddy's
// `reverse_proxy` actually forwards as `X-Forwarded-For` — rather than
// assuming it. Skipped automatically when the throwaway stack is not
// running, the same way `smtp-imap.test.ts` skips without GreenMail.
//
// What this proves and why it is enough: `docs/security.md` traces
// `@better-auth/core`'s rate limiter (`getIp`/`getIPFromHeader`, read
// directly from `node_modules`) to a simple rule — trust a single-value
// `X-Forwarded-For` verbatim, treat more than one value as untrustworthy.
// That rule only resolves the real visitor's address if Caddy itself never
// lets a client dictate (or pad) the header. This test is the empirical
// half of that argument: it sends a request with a forged
// `X-Forwarded-For` through the real proxy config and asserts the backend
// only ever sees Caddy's own observation of the immediate connection, as a
// single value, never the forged one and never more than one value —
// exactly what better-auth's single-value-trust rule assumes.
import { expect, test } from 'vitest';

const PROXY_URL = 'http://127.0.0.1:34180/';

interface EchoResponse {
	readonly headers: Record<string, string | string[] | undefined>;
}

async function probeProxy(): Promise<boolean> {
	try {
		const response = await fetch(PROXY_URL, { signal: AbortSignal.timeout(2000) });
		return response.ok;
	} catch {
		return false;
	}
}

// Top-level await: the availability check has to happen before
// `test.skipIf` is evaluated at collection time, not inside a `beforeAll`
// (which runs too late to gate which tests are even registered).
const proxyAvailable = await probeProxy();
if (!proxyAvailable) {
	console.warn(
		'caddy-xff.test.ts: no test proxy at 127.0.0.1:34180 — skipping. ' +
			'Run `docker compose -p mastro-xff-test -f compose.xff-test.yaml up -d` first.'
	);
}

test.skipIf(!proxyAvailable)(
	'a request with no X-Forwarded-For gets Caddy\u2019s own single-value observation of the caller',
	async () => {
		const response = await fetch(PROXY_URL);
		const body = (await response.json()) as EchoResponse;
		const forwardedFor = body.headers['x-forwarded-for'];

		expect(typeof forwardedFor).toBe('string');
		// Exactly one address: no comma-joined chain, which is what
		// better-auth's `getIPFromHeader` requires to trust it without a
		// configured `trustedProxies` list.
		expect((forwardedFor as string).split(',')).toHaveLength(1);
	}
);

test.skipIf(!proxyAvailable)(
	'a client-supplied X-Forwarded-For is discarded, never appended to or trusted as-is',
	async () => {
		const spoofed = '6.6.6.6';

		const baseline = await fetch(PROXY_URL);
		const baselineBody = (await baseline.json()) as EchoResponse;
		const baselineForwardedFor = baselineBody.headers['x-forwarded-for'];

		const response = await fetch(PROXY_URL, { headers: { 'X-Forwarded-For': spoofed } });
		const body = (await response.json()) as EchoResponse;
		const forwardedFor = body.headers['x-forwarded-for'];

		// Caddy's default (no `trusted_proxies` configured in
		// `deploy/Caddyfile`) is to overwrite the header with its own view
		// of the immediate peer, not append to whatever the client sent —
		// so the spoofed value never appears, and the result is identical
		// to a request that sent no header at all.
		expect(forwardedFor).not.toBe(spoofed);
		expect(forwardedFor).not.toContain(spoofed);
		expect(forwardedFor).toBe(baselineForwardedFor);
		expect(typeof forwardedFor).toBe('string');
		expect((forwardedFor as string).split(',')).toHaveLength(1);
	}
);

test.skipIf(!proxyAvailable)(
	'a multi-hop X-Forwarded-For chain from the client is also collapsed to Caddy\u2019s own single value',
	async () => {
		const response = await fetch(PROXY_URL, {
			headers: { 'X-Forwarded-For': '6.6.6.6, 7.7.7.7' }
		});
		const body = (await response.json()) as EchoResponse;
		const forwardedFor = body.headers['x-forwarded-for'];

		expect(forwardedFor).not.toContain('6.6.6.6');
		expect(forwardedFor).not.toContain('7.7.7.7');
		expect(typeof forwardedFor).toBe('string');
		expect((forwardedFor as string).split(',')).toHaveLength(1);
	}
);
