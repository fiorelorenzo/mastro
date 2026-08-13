// A `node:module` customization hook that lets `seed-demo.ts` `import` the
// real repository layer — `src/lib/server/repositories/*`, and everything
// under `src/lib/server/db/schema` it pulls in — on plain `node`, with no
// bundler and no dev dependency, the same "no build step" requirement
// `scripts/migrate.ts` and `scripts/runner.ts` already have.
//
// Two things in that tree do not resolve under Node's own ESM loader:
//
// 1. `$lib/...` — a SvelteKit path alias, meaningless outside Vite/
//    svelte-kit's bundler resolution.
// 2. Extensionless relative specifiers (`from './client'`, not
//    `from './client.ts'`) — valid under "bundler" module resolution
//    (`tsconfig.json`), which is how `svelte-check`/Vite read this
//    codebase, but not under plain Node ESM, which never infers an
//    extension for you. `scripts/record-backup-run.ts`'s header comment
//    documents this same wall; `src/lib/server/runner/*` is the one
//    subtree written with explicit `.ts` extensions throughout so
//    `scripts/runner.ts` can import it directly. The repository layer was
//    never written that way, and rewriting it is a much larger change than
//    a seed script — this hook closes the gap instead, at the one call
//    site that needs it.
//
// `$env/dynamic/private` is the third wall: a SvelteKit virtual module with
// no meaning outside a SvelteKit server process. `seed-env-shim.ts`
// re-exports `process.env` under the same name it imports as (`env`), which
// is what that module resolves to at runtime anyway.
//
// Registered by `seed-demo.ts` itself via `node:module`'s `register()`,
// before it dynamically `import()`s anything under `$lib` — a *static*
// top-level import of a `$lib`-aliased module in the entrypoint itself
// would already have been resolved before registration takes effect.

import type { ResolveFnOutput, ResolveHook } from 'node:module';

const SRC_LIB = new URL('../src/lib/', import.meta.url);
const ENV_SHIM = new URL('./seed-env-shim.ts', import.meta.url);

// Tried in order once a specifier fails to resolve as given — `.ts` first
// since that is the entire tree's own source extension, `/index.ts` for a
// directory import (`$lib/server/db` names `src/lib/server/db/index.ts`
// this way).
const EXTENSION_FALLBACKS = ['.ts', '.js', '/index.ts', '/index.js'];

// The two failure modes an unresolved specifier from this tree produces:
// a plain miss (`ERR_MODULE_NOT_FOUND`, the extensionless-file case) and a
// miss that happens to name a real directory (`ERR_UNSUPPORTED_DIR_IMPORT`,
// the `/index.ts` case) — retried the same way either way.
const RETRYABLE_ERROR_CODES: Record<string, true> = {
	ERR_MODULE_NOT_FOUND: true,
	ERR_UNSUPPORTED_DIR_IMPORT: true
};

function isRetryable(error: unknown): boolean {
	return (
		error instanceof Error &&
		RETRYABLE_ERROR_CODES[(error as NodeJS.ErrnoException).code ?? ''] === true
	);
}

async function resolveWithFallback(
	specifier: string,
	context: Parameters<ResolveHook>[1],
	nextResolve: Parameters<ResolveHook>[2]
): Promise<ResolveFnOutput> {
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		if (!isRetryable(error)) throw error;
		for (const suffix of EXTENSION_FALLBACKS) {
			try {
				return await nextResolve(specifier + suffix, context);
			} catch (candidateError) {
				if (!isRetryable(candidateError)) throw candidateError;
			}
		}
		throw error;
	}
}

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
	if (specifier === '$env/dynamic/private') {
		return nextResolve(ENV_SHIM.href, context);
	}
	if (specifier.startsWith('$lib/')) {
		const rewritten = new URL(specifier.slice('$lib/'.length), SRC_LIB).href;
		return resolveWithFallback(rewritten, context, nextResolve);
	}
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		return resolveWithFallback(specifier, context, nextResolve);
	}
	return nextResolve(specifier, context);
};
