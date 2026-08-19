import { afterEach, expect, test, vi } from 'vitest';
import { createMirrorTarget, readMirrorConfig } from './config';

afterEach(() => {
	vi.restoreAllMocks();
});

test('no DRIVE_MIRROR_* variables set is a supported, silent configuration', () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});

	expect(readMirrorConfig({})).toBeNull();
	expect(readMirrorConfig({ SMTP_HOST: 'smtp.example.com', GOOGLE_CLIENT_ID: 'x' })).toBeNull();

	expect(log).not.toHaveBeenCalled();
	expect(warn).not.toHaveBeenCalled();
	expect(error).not.toHaveBeenCalled();
});

test('DRIVE_MIRROR_LOCAL_ROOT alone selects the local target', () => {
	const config = readMirrorConfig({ DRIVE_MIRROR_LOCAL_ROOT: '/mnt/drive-mirror' });
	expect(config).toEqual({
		kind: 'local',
		rootDir: '/mnt/drive-mirror',
		folder: { contractsFolderName: 'Contracts' }
	});
});

test('DRIVE_MIRROR_REFRESH_TOKEN plus the existing Google OAuth client selects Drive', () => {
	const config = readMirrorConfig({
		DRIVE_MIRROR_REFRESH_TOKEN: 'refresh-token',
		GOOGLE_CLIENT_ID: 'client-id',
		GOOGLE_CLIENT_SECRET: 'client-secret'
	});
	expect(config).toEqual({
		kind: 'google-drive',
		clientId: 'client-id',
		clientSecret: 'client-secret',
		refreshToken: 'refresh-token',
		folder: { contractsFolderName: 'Contracts' }
	});
});

test('a refresh token with no OAuth client configured is a loud misconfiguration, not a silent skip', () => {
	expect(() => readMirrorConfig({ DRIVE_MIRROR_REFRESH_TOKEN: 'refresh-token' })).toThrow(
		/GOOGLE_CLIENT_ID/
	);
});

test('both targets configured at once is rejected rather than picking one silently', () => {
	expect(() =>
		readMirrorConfig({
			DRIVE_MIRROR_LOCAL_ROOT: '/mnt/drive-mirror',
			DRIVE_MIRROR_REFRESH_TOKEN: 'refresh-token',
			GOOGLE_CLIENT_ID: 'client-id',
			GOOGLE_CLIENT_SECRET: 'client-secret'
		})
	).toThrow(/exactly one/);
});

test('createMirrorTarget builds a target with a publish method for either kind', () => {
	const local = createMirrorTarget({
		kind: 'local',
		rootDir: '/tmp/does-not-matter',
		folder: { contractsFolderName: 'Contracts' }
	});
	expect(typeof local.publish).toBe('function');

	const drive = createMirrorTarget({
		kind: 'google-drive',
		clientId: 'client-id',
		clientSecret: 'client-secret',
		refreshToken: 'refresh-token',
		folder: { contractsFolderName: 'Contracts' }
	});
	expect(typeof drive.publish).toBe('function');
});

/* #348: same override, same reason, for the mirror. */
test('GOOGLE_API_CLIENT_* overrides the sign-in client for the Drive mirror', () => {
	const config = readMirrorConfig({
		GOOGLE_CLIENT_ID: 'sign-in-id',
		GOOGLE_CLIENT_SECRET: 'sign-in-secret',
		GOOGLE_API_CLIENT_ID: 'issuing-id',
		GOOGLE_API_CLIENT_SECRET: 'issuing-secret',
		DRIVE_MIRROR_REFRESH_TOKEN: 'refresh-token'
	});

	expect(config).toMatchObject({
		kind: 'google-drive',
		clientId: 'issuing-id',
		clientSecret: 'issuing-secret',
		refreshToken: 'refresh-token'
	});
});
