/**
 * Where every mail test that talks to a real server finds it: the
 * loopback host and the two ports `compose.mail-test.yaml` publishes
 * GreenMail on. Read from the same environment variables the compose
 * file defaults from — `MAIL_TEST_SMTP_PORT`/`MAIL_TEST_IMAP_PORT` — so a
 * checkout that gives its container its own ports also gets its own
 * tests pointed at them, rather than the container getting isolated
 * while every test still dials a hardcoded 34025/34143 (#429). Unset,
 * both default to the values the file has always published, so a single
 * checkout needs no configuration. See AGENTS.md, "the mail test server
 * is per-checkout too".
 *
 * `process.env` directly, not `$env/dynamic/private`: this only ever
 * runs inside a test file, the same way `dispatch.test.ts` already reads
 * `process.env.SMTP_HOST` for its own gate.
 */
export const MAIL_TEST_HOST = '127.0.0.1';
export const MAIL_TEST_SMTP_PORT = Number(process.env.MAIL_TEST_SMTP_PORT ?? 34025);
export const MAIL_TEST_IMAP_PORT = Number(process.env.MAIL_TEST_IMAP_PORT ?? 34143);
