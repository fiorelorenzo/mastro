import { expect, test } from 'vitest';
import { describeDatabaseTarget, describeTargetMismatch } from './target';

test('describes user, host, port and database without the password', () => {
	const described = describeDatabaseTarget('postgres://mastro:hunter2@localhost:5436/mastro');
	expect(described).toBe('mastro@localhost:5436/mastro');
	expect(described).not.toContain('hunter2');
});

test('falls back to the default port when the URL omits it', () => {
	expect(describeDatabaseTarget('postgresql://mastro@db.internal/mastro')).toBe(
		'mastro@db.internal:5432/mastro'
	);
});

test('describes a unix socket connection by its socket directory', () => {
	expect(describeDatabaseTarget('postgres:///mastro?host=/var/run/postgresql')).toBe(
		'(no user)@/var/run/postgresql:5432/mastro'
	);
});

test('describes a URL with no scheme without echoing its password', () => {
	// This one parses: the protocol becomes `mastro:` and the password ends
	// up in the path, so a field-by-field description would leak it.
	const described = describeDatabaseTarget('mastro:hunter2@localhost/mastro');
	expect(described).toBe('(unrecognised DATABASE_URL)');
	expect(described).not.toContain('hunter2');
});

test('describes a value that is not a URL at all without echoing it', () => {
	expect(describeDatabaseTarget('hunter2')).toBe('(unrecognised DATABASE_URL)');
});

test('warns and names both databases when the environment overrides .env', () => {
	const warning = describeTargetMismatch(
		'postgres://mastro:pw@localhost:5436/mastro',
		'postgres://mastro:pw@localhost:5445/mastro'
	);
	expect(warning).toContain('mastro@localhost:5436/mastro');
	expect(warning).toContain('mastro@localhost:5445/mastro');
	expect(warning).not.toContain('pw@');
});

test('stays quiet when the environment and .env agree', () => {
	expect(
		describeTargetMismatch(
			'postgres://mastro:pw@localhost:5436/mastro',
			'postgres://mastro:pw@localhost:5436/mastro'
		)
	).toBeNull();
});

test('stays quiet when the two URLs differ only by password', () => {
	expect(
		describeTargetMismatch(
			'postgres://mastro:one@localhost:5436/mastro',
			'postgres://mastro:two@localhost:5436/mastro'
		)
	).toBeNull();
});

test('stays quiet when there is nothing to compare against', () => {
	expect(describeTargetMismatch('postgres://mastro@localhost:5436/mastro', undefined)).toBeNull();
	expect(describeTargetMismatch(undefined, 'postgres://mastro@localhost:5436/mastro')).toBeNull();
});
