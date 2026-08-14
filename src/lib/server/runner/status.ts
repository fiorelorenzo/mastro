// Whether the ACP runner has a model command configured, from the web
// app's own point of view (#246, the settings health page). Deliberately
// a separate file from `runner/config.ts`, not an added export there:
// that file's own header explains why it never imports
// `$env/dynamic/private` — it has to run unmodified under plain `node`
// for the runner process itself (`scripts/runner.ts`), and pulling in a
// SvelteKit-only virtual module would break that. `web` and `runner`
// load the same `.env.prod` (`compose.prod.yaml`'s `env_file:` on both
// services), so the app can safely probe `RUNNER_AGENT_COMMAND` in its
// own environment — the same convention `mail/config.ts`'s
// `isImapConfigured`/`imapConfiguredInEnv` and `drive/config.ts`'s
// `mirrorConfigFromEnv` already establish for "is the sibling process
// that actually does the work configured at all".
//
// This is a narrower question than `runner/config.ts`'s own
// `loadRunnerConfig`, and deliberately so: that throws on a malformed
// `RUNNER_AGENT_ARGS`/`RUNNER_AGENT_ENV`, correct for the runner process
// itself (fail loudly rather than silently drop configuration), wrong
// for a settings screen that must render either way — a safe boolean
// probe, mirroring `isImapConfigured`'s own "without throwing" doc.
import { env } from '$env/dynamic/private';

/** Parses out of a plain env-like object so it is exercised directly
 * against fabricated input, the same split `isImapConfigured` uses. */
export function isRunnerConfigured(source: Record<string, string | undefined>): boolean {
	return Boolean(source.RUNNER_AGENT_COMMAND?.trim());
}

export function runnerConfiguredInEnv(): boolean {
	return isRunnerConfigured(env);
}
