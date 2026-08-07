// VAPID configuration for Web Push (#63), read from environment on
// demand — the same convention `mail/config.ts` sets for SMTP/IMAP, and
// for the same reason: a self-hoster who has not generated a VAPID key
// pair yet must still be able to run every other screen in the product.
import { env } from '$env/dynamic/private';

export type VapidConfig = {
	readonly publicKey: string;
	readonly privateKey: string;
	/** `mailto:` address or `https:` URL identifying the application server
	 * to a push service, as VAPID (RFC 8292) requires. */
	readonly subject: string;
};

function required(source: Record<string, string | undefined>, key: string): string {
	const value = (source[key] ?? '').trim();
	if (!value) {
		throw new Error(
			`${key} is not set. Web push needs the full VAPID configuration — see .env.example.`
		);
	}
	return value;
}

/** Parses VAPID settings out of a plain env-like object — a pure
 * function, exercised directly, mirroring `readMailConfig`. */
export function readVapidConfig(source: Record<string, string | undefined>): VapidConfig {
	return {
		publicKey: required(source, 'VAPID_PUBLIC_KEY'),
		privateKey: required(source, 'VAPID_PRIVATE_KEY'),
		subject: required(source, 'VAPID_SUBJECT')
	};
}

/** The real configuration, read from the process environment. Every
 * caller that needs to actually send calls this at the point of sending,
 * never at import time — same convention as `mailConfigFromEnv`. */
export function vapidConfigFromEnv(): VapidConfig {
	return readVapidConfig(env);
}

/** The public key alone, for the subscribe screen — never the private
 * key, which stays server-side. Throws the same way `vapidConfigFromEnv`
 * does when unconfigured; the settings page catches that to show "push is
 * not configured on this instance" rather than a stack trace. */
export function vapidPublicKeyFromEnv(): string {
	return vapidConfigFromEnv().publicKey;
}
