import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => ({
	// Fixed port so several projects can run side by side on one box, and
	// overridable per checkout the way POSTGRES_PORT already is, because a
	// worktree needs its own (#157). strictPort because the default is to
	// drift quietly to the next free number, and a server you did not notice
	// moving is a server you will later verify the wrong branch on. Note this
	// does not separate session cookies between checkouts: cookies ignore the
	// port entirely, so that needs an isolated browser context. See AGENTS.md.
	server: { port: Number(loadEnv(mode, process.cwd(), '').WEB_PORT ?? 5187), strictPort: true },
	preview: { port: Number(loadEnv(mode, process.cwd(), '').WEB_PORT ?? 5187), strictPort: true },
	// `pdf-parse` wraps pdfjs, whose module body touches DOM globals Node has
	// not got. Bundled into a server chunk it therefore throws
	// `DOMMatrix is not defined` the moment anything in that chunk is loaded,
	// which took `/api/agent/run` down on every scheduler tick in production
	// while every test stayed green (#267). Left external it is a plain
	// runtime `import()` from node_modules, evaluated only when a PDF is
	// actually read — so it is a runtime dependency, not a dev one.
	ssr: { external: ['pdf-parse'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Absolute hrefs, not page-relative ones. SvelteKit defaults
			// `paths.relative` to true, which makes `resolve()` return a path
			// relative to the page it is called from ("../day/calendar"). That is
			// fine for an href rendered straight into markup, and wrong the moment
			// a resolved path is carried in load data and resolved again on the way
			// out: the second call rejects a non-absolute pathname and the page
			// 500s. A breadcrumb trail is exactly that shape, built in a loader and
			// rendered by PageHeader. This app is served from a domain root and has
			// no `paths.base`, so root-relative hrefs are always correct here and
			// relative ones buy nothing.
			paths: { relative: false },
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts', '../scripts/**/*.ts');
				}
			}
		}),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// Cookie survives a language switch; Accept-Language guesses before the
			// user ever picks; baseLocale is the final fallback. No "url" strategy:
			// this app does not route by locale prefix.
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
			emitTsDeclarations: true
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
}));
