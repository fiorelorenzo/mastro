import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// #390's fix only holds while every id-shaped route segment actually uses
// the `uuid` matcher. The matcher is what makes a malformed id 404 before
// any loader runs, but nothing in SvelteKit obliges a new route to opt in:
// write `[id]` instead of `[id=uuid]` and the segment reaches the loader as
// an ordinary string, gets handed to a query, and Postgres's rejection
// comes back as a 500 again. That is the decay this test exists to stop,
// so the guard lives here rather than in a convention somebody has to
// remember.
//
// The rule is deliberately narrow: a segment whose name is `id` or ends in
// `Id` names a database row's primary key in this codebase, and every one
// of those is a uuid. A segment named for something else (`[job]`, and the
// `[...all]` auth catch-all) is not making that claim and is left alone.

const ROUTES = 'src/routes';

function segments(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const path = join(dir, entry.name);
		if (entry.name.startsWith('[')) found.push(path);
		segments(path, found);
	}
	return found;
}

test('every id-shaped route segment is matched as a uuid', () => {
	const unmatched = segments(ROUTES)
		.filter((path) => {
			const name = path.slice(path.lastIndexOf('[') + 1, -1);
			if (name.includes('=')) return false;
			if (name.startsWith('...')) return false;
			return name === 'id' || name.endsWith('Id');
		})
		.sort();

	// Naming the paths rather than counting them: the failure has to say
	// which route to fix, or the next person reads the matcher instead.
	expect(unmatched).toEqual([]);
});

test('the segments this codebase deliberately does not match are still unmatched', () => {
	// The inverse half, so the rule above cannot be satisfied by matching
	// everything: these two carry no uuid, and forcing them through the
	// matcher would 404 every legitimate request they serve.
	const all = segments(ROUTES).map((path) => path.slice(path.lastIndexOf('[') + 1, -1));
	expect(all).toContain('job');
	expect(all.some((name) => name.startsWith('...'))).toBe(true);
});
