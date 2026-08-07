import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// Fixed port so several projects can run side by side on one box.
	server: { port: 5187 },
	preview: { port: 5187 },
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
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
