// #422: a `m.someMessage()` call that runs outside any function executes
// exactly once, at module-evaluation time, and its return value is frozen
// for the life of the process — correct for whichever locale happened to
// be active during that one call, wrong for every request afterward. That
// is the day-state-badge.ts bug (and its source-document.ts sibling) this
// issue fixed: a `Record<State, StateBadge>` built with `m.day_state_x()`
// values instead of the message *functions*.
//
// This scans the way no-country-logic.test.ts does (AGENTS.md invariant
// 1's own detector) — every non-generated .ts file whole, and a .svelte
// file's `<script module>` block, which is real module scope in Svelte
// too. A plain `<script>` block is deliberately left alone: SvelteKit
// re-evaluates a component's instance script on every instantiation
// (once per request under SSR), so `m.*()` called there already resolves
// against the current locale — the correct, dominant pattern in this
// codebase (Button.svelte, CashCalendarChart.svelte, nav/crumbs.ts, …).
//
// Unlike no-country-logic.test.ts's regex rules, this one parses the
// source with the TypeScript compiler (already a project dependency):
// distinguishing "inside a function" from "not" by text pattern alone is
// exactly the kind of thing that produces false positives/negatives, and
// a real parser removes the guesswork for a handful of lines of code.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/i18n/, two levels below src/.
const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const EXEMPT_DIR_NAMES: Record<string, true> = {
	node_modules: true,
	'.svelte-kit': true,
	// Generated from messages/*.json by paraglide-js: not source, and not
	// where an application call site could ever go wrong.
	paraglide: true
};

/** Every `.ts` (excluding declaration files) and `.svelte` file under
 *  `root`, skipping generated/dependency directories. */
function listScannedFiles(root: string, dir: string = root, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (EXEMPT_DIR_NAMES[entry]) continue;
		const full = `${dir}/${entry}`;
		if (statSync(full).isDirectory()) {
			listScannedFiles(root, full, out);
			continue;
		}
		if ((entry.endsWith('.ts') && !entry.endsWith('.d.ts')) || entry.endsWith('.svelte')) {
			out.push(full);
		}
	}
	return out;
}

/** A `.svelte` file's `<script module>` / `<script context="module">`
 *  block content, concatenated — the one part of a component file that is
 *  genuine module scope, evaluated once regardless of how many times the
 *  component renders. A plain `<script>` block is not module scope in the
 *  sense this rule cares about and is excluded on purpose. */
function moduleScriptContent(source: string): string {
	const blocks: string[] = [];
	const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
	for (const match of source.matchAll(scriptTag)) {
		const attrs = match[1];
		if (/\bmodule\b/.test(attrs) || /context\s*=\s*["']module["']/.test(attrs)) {
			blocks.push(match[2]);
		}
	}
	return blocks.join('\n');
}

/** Line numbers (1-based) of every `m.someMessage(...)` call in `code`
 *  that is not inside any function — i.e. a call that runs once, at
 *  module-evaluation time, rather than once per render/request. A
 *  function *reference* (`m.someMessage` with no call) is never flagged:
 *  passing the function itself, to be called later, is the correct
 *  pattern (see `nav/items.ts`'s `label: m.nav_today`). */
function moduleScopeMessageCalls(code: string, fileName: string): number[] {
	const sourceFile = ts.createSourceFile(
		fileName,
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	);
	const violations: number[] = [];

	function isFunctionLike(node: ts.Node): boolean {
		return (
			ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isGetAccessorDeclaration(node) ||
			ts.isSetAccessorDeclaration(node) ||
			ts.isConstructorDeclaration(node)
		);
	}

	function isMessageCall(node: ts.Node): node is ts.CallExpression {
		return (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === 'm'
		);
	}

	function visit(node: ts.Node, insideFunction: boolean): void {
		if (!insideFunction && isMessageCall(node)) {
			violations.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
		}
		const nextInsideFunction = insideFunction || isFunctionLike(node);
		ts.forEachChild(node, (child) => visit(child, nextInsideFunction));
	}

	visit(sourceFile, false);
	return violations;
}

describe('the detector itself', () => {
	test('flags a message call assigned directly at module scope', () => {
		expect(moduleScopeMessageCalls(`const label = m.day_state_proposed();`, 'x.ts')).toEqual([1]);
	});

	test('flags a message call inside a module-level object literal', () => {
		const code = `const BADGE = {\n\tproposed: badge('neutral', m.day_state_proposed())\n};`;
		expect(moduleScopeMessageCalls(code, 'x.ts')).toEqual([2]);
	});

	test('does not flag a message call inside a function body', () => {
		const code = `function label() {\n\treturn m.day_state_proposed();\n}`;
		expect(moduleScopeMessageCalls(code, 'x.ts')).toEqual([]);
	});

	test('does not flag a message call inside an arrow function', () => {
		const code = `const label = () => m.day_state_proposed();`;
		expect(moduleScopeMessageCalls(code, 'x.ts')).toEqual([]);
	});

	test('does not flag a bare function reference (never called)', () => {
		const code = `const BADGE = {\n\tproposed: { label: m.day_state_proposed }\n};`;
		expect(moduleScopeMessageCalls(code, 'x.ts')).toEqual([]);
	});

	test('extracts only <script module> content from a .svelte file, not the instance script', () => {
		const source = [
			'<script module>',
			'const frozen = m.a();',
			'</script>',
			'<script>',
			'const perRender = m.b();',
			'</script>'
		].join('\n');
		expect(moduleScriptContent(source)).toContain('m.a()');
		expect(moduleScriptContent(source)).not.toContain('m.b()');
	});
});

describe('the shipped tree', () => {
	test('no .ts file calls a message function at module scope', () => {
		const offenders: string[] = [];
		for (const file of listScannedFiles(SRC_ROOT)) {
			if (!file.endsWith('.ts')) continue;
			const source = readFileSync(file, 'utf8');
			for (const line of moduleScopeMessageCalls(source, file)) {
				offenders.push(`${file.slice(SRC_ROOT.length)}:${line}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test('no .svelte <script module> block calls a message function at module scope', () => {
		const offenders: string[] = [];
		for (const file of listScannedFiles(SRC_ROOT)) {
			if (!file.endsWith('.svelte')) continue;
			const source = readFileSync(file, 'utf8');
			const moduleScript = moduleScriptContent(source);
			if (!moduleScript) continue;
			for (const line of moduleScopeMessageCalls(moduleScript, file)) {
				offenders.push(`${file.slice(SRC_ROOT.length)}:${line}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
