// #298: `compose.prod.yaml` used to give the runner service
// `env_file: .env.prod`, handing the process every secret in that file
// (POSTGRES_PASSWORD, BETTER_AUTH_SECRET, both cron tokens, the Google
// client secret, the SMTP/IMAP app passwords, VAPID_PRIVATE_KEY) on a
// network where `db` is reachable, while Dockerfile:108-111 said in
// plain words that this container never receives the app's own database
// credentials. Both statements looked true in isolation, one of them was
// wrong about fact for the whole of v1. A comment is not a control: this
// test parses the actual compose file and fails the same way a
// reintroduced `env_file` or an unlisted `environment` key would.
//
// This project has no YAML parser dependency (see package.json), so
// parsing here is deliberately narrow: it understands exactly the
// two-space-indented block mapping shape `compose.prod.yaml` already
// uses everywhere, not general YAML.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const COMPOSE_PATH = new URL('../../../../compose.prod.yaml', import.meta.url);

/**
 * Every name the runner process actually reads from `process.env`,
 * verified against `src/lib/server/runner/config.ts`'s
 * `loadRunnerConfig` and `docs/agent-runner.md`'s "Configuration"
 * section: `RUNNER_DATABASE_URL` (required), `RUNNER_AGENT_COMMAND`,
 * `RUNNER_AGENT_ARGS`, `RUNNER_AGENT_ENV` and `RUNNER_MODEL_TIMEOUT_MS`
 * (all optional). `RUNNER_QUEUE_DIR` is deliberately not here: in
 * production the queue directory is fixed by the `runner_queue` named
 * volume mount, not something a self-hoster should be able to move out
 * from under it by editing `.env.prod`.
 *
 * None of these are credentials the app itself uses. Adding a key here
 * is a deliberate, reviewable change to what this container can read;
 * that is the entire point of this allowlist existing.
 */
const RUNNER_ENV_ALLOWLIST = [
	'RUNNER_DATABASE_URL',
	'RUNNER_AGENT_COMMAND',
	'RUNNER_AGENT_ARGS',
	'RUNNER_AGENT_ENV',
	'RUNNER_MODEL_TIMEOUT_MS'
];

/**
 * Extracts one top-level service's own lines from a compose file's text:
 * everything strictly between `  <name>:` and the next line dedented
 * back to two spaces or less (the next service, a comment ahead of one,
 * or EOF). Blank lines inside the block are kept; nothing outside it is.
 */
function extractServiceBlock(composeText: string, serviceName: string): string[] {
	const lines = composeText.split('\n');
	const startIndex = lines.indexOf(`  ${serviceName}:`);
	if (startIndex === -1) {
		throw new Error(`service '${serviceName}' not found in compose.prod.yaml`);
	}
	let endIndex = lines.length;
	for (let i = startIndex + 1; i < lines.length; i++) {
		if (/^ {0,2}\S/.test(lines[i])) {
			endIndex = i;
			break;
		}
	}
	return lines.slice(startIndex + 1, endIndex);
}

/**
 * The `environment:` mapping's own keys, one indent level deeper than
 * `environment:` itself (six spaces, since the service name is two and
 * its direct keys are four). Comments and blank lines are skipped; a
 * line that reaches this depth but does not look like `KEY: value` is a
 * parse failure, not a silent skip, since a list item here (the shape
 * `env_file:` uses) would mean this is no longer a plain key/value map.
 */
function environmentKeys(serviceBlock: string[]): string[] {
	const envIndex = serviceBlock.indexOf('    environment:');
	if (envIndex === -1) return [];
	const keys: string[] = [];
	for (const line of serviceBlock.slice(envIndex + 1)) {
		if (line.trim() === '') continue;
		if (!line.startsWith('      ')) break;
		if (line.trim().startsWith('#')) continue;
		const match = /^ {6}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
		if (!match) {
			throw new Error(`unparseable line under runner's environment: '${line}'`);
		}
		keys.push(match[1]);
	}
	return keys;
}

describe('compose.prod.yaml runner service', () => {
	const composeText = readFileSync(COMPOSE_PATH, 'utf8');
	const runnerBlock = extractServiceBlock(composeText, 'runner');

	test('has no env_file', () => {
		const hasEnvFile = runnerBlock.some((line) => line.trim().startsWith('env_file:'));
		expect(hasEnvFile).toBe(false);
	});

	test('environment keys are a subset of the explicit allowlist', () => {
		const keys = environmentKeys(runnerBlock);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect(RUNNER_ENV_ALLOWLIST).toContain(key);
		}
	});

	test('RUNNER_DATABASE_URL is present and uses the mastro_runner role', () => {
		const keys = environmentKeys(runnerBlock);
		expect(keys).toContain('RUNNER_DATABASE_URL');
		const line = runnerBlock.find((l) => l.trim().startsWith('RUNNER_DATABASE_URL:'));
		expect(line).toContain('mastro_runner');
		expect(line).not.toContain('POSTGRES_PASSWORD');
	});

	test('none of the app-only credentials appear in the runner block outside comments', () => {
		// Only functional (non-comment) lines matter here: this line's own
		// explanatory comments above deliberately name these variables in
		// prose to say they are absent, which would otherwise trip this
		// check on its own text.
		const codeText = runnerBlock.filter((line) => !line.trim().startsWith('#')).join('\n');
		for (const credential of [
			'POSTGRES_PASSWORD',
			'BETTER_AUTH_SECRET',
			'GOOGLE_CLIENT_SECRET',
			'SMTP_APP_PASSWORD',
			'IMAP_APP_PASSWORD',
			'ALERT_CRON_TOKEN',
			'IMAP_POLL_CRON_TOKEN',
			'VAPID_PRIVATE_KEY'
		]) {
			expect(codeText).not.toContain(credential);
		}
	});
});
