import { expect, test } from 'vitest';
import { readVapidConfig } from './config';

test('missing VAPID variables throw a clear, specific error rather than silently producing an unusable config', () => {
	expect(() => readVapidConfig({})).toThrow(/VAPID_PUBLIC_KEY/);
	expect(() => readVapidConfig({ VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID_PRIVATE_KEY/);
	expect(() => readVapidConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toThrow(
		/VAPID_SUBJECT/
	);
});

test('a full VAPID configuration parses verbatim', () => {
	expect(
		readVapidConfig({
			VAPID_PUBLIC_KEY: 'pub',
			VAPID_PRIVATE_KEY: 'priv',
			VAPID_SUBJECT: 'mailto:ops@example.com'
		})
	).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@example.com' });
});
