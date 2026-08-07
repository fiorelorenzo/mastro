// Which mirror target, if any, is configured (#50). Read from environment
// on demand, the same as `mail/config.ts`'s `readMailConfig` — and for a
// related but stronger reason: mail without configuration still throws
// when a human actually tries to send, because sending is a deliberate
// action with nobody around to be surprised by the error. The mirror has
// no such moment. Nothing in the app calls `mirrorConfigFromEnv` on the
// request path, so a self-hoster who never sets a `DRIVE_MIRROR_*`
// variable never triggers this module at all — and when something
// eventually does call it with nothing configured, it returns `null`
// rather than throwing, so there is no error for that caller to log
// either. That is the acceptance criterion "running with no mirror
// configured is a supported, silent configuration" end to end: not just
// "no crash", but genuinely nothing, ever, on that path.
import { env } from '$env/dynamic/private';
import { readMirrorFolderConfig, type MirrorFolderConfig } from './folder';
import { createGoogleDriveMirrorTarget, type GoogleDriveTargetConfig } from './google-drive-target';
import { createLocalDirectoryMirrorTarget } from './local-target';
import type { MirrorTarget } from './mirror-target';

export type MirrorConfig =
	| { readonly kind: 'local'; readonly rootDir: string; readonly folder: MirrorFolderConfig }
	| ({
			readonly kind: 'google-drive';
			readonly folder: MirrorFolderConfig;
	  } & GoogleDriveTargetConfig);

/**
 * Parses the mirror's configuration out of a plain env-like object — a
 * pure function, exercised directly, mirroring `readMailConfig`.
 * `DRIVE_MIRROR_LOCAL_ROOT` selects the local directory target,
 * `DRIVE_MIRROR_REFRESH_TOKEN` selects Google Drive (reusing
 * `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, already configured for
 * sign-in — see `google-drive-target.ts`). Neither set: `null`, the
 * supported "no mirror" configuration. Both set, or Drive selected
 * without the OAuth client it needs: a thrown error, because that is a
 * self-hoster's configuration mistake, not the absence of one, and
 * deserves to fail loudly the moment something tries to use it — same
 * distinction `mail/config.ts` draws between "unset" and "half set".
 */
export function readMirrorConfig(source: Record<string, string | undefined>): MirrorConfig | null {
	const localRoot = source.DRIVE_MIRROR_LOCAL_ROOT?.trim();
	const refreshToken = source.DRIVE_MIRROR_REFRESH_TOKEN?.trim();

	if (localRoot && refreshToken) {
		throw new Error(
			'Both DRIVE_MIRROR_LOCAL_ROOT and DRIVE_MIRROR_REFRESH_TOKEN are set; configure exactly one mirror target.'
		);
	}

	if (refreshToken) {
		const clientId = source.GOOGLE_CLIENT_ID?.trim();
		const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
		if (!clientId || !clientSecret) {
			throw new Error(
				'DRIVE_MIRROR_REFRESH_TOKEN is set but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not — the Drive mirror reuses the same OAuth client as sign-in, see docs/self-hosting.md.'
			);
		}
		return {
			kind: 'google-drive',
			clientId,
			clientSecret,
			refreshToken,
			folder: readMirrorFolderConfig(source)
		};
	}

	if (localRoot) {
		return { kind: 'local', rootDir: localRoot, folder: readMirrorFolderConfig(source) };
	}

	return null;
}

/** The real configuration, read from the process environment. Callers —
 * `publishAllPending` and, eventually, whatever schedules it — call this
 * once per run, never at module load. */
export function mirrorConfigFromEnv(): MirrorConfig | null {
	return readMirrorConfig(env);
}

/** Builds the `MirrorTarget` a resolved `MirrorConfig` names. */
export function createMirrorTarget(config: MirrorConfig): MirrorTarget {
	if (config.kind === 'local') return createLocalDirectoryMirrorTarget(config.rootDir);
	return createGoogleDriveMirrorTarget(config);
}
