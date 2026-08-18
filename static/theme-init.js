// Pre-paint theme stamp, extracted out of `src/app.html` for #303: a CSP
// strict enough to matter (`default-src 'self'`, no inline-script
// exception) cannot allow an inline script on a page SvelteKit ever
// prerenders — `%sveltekit.nonce%` throws at build time the moment any
// route (here, `/offline`) is prerendered, per SvelteKit's own
// `render_response` — so this runs as a same-origin external script
// instead, which `script-src 'self'` already allows with no nonce or hash
// needed. Loaded as a plain, blocking, non-module `<script src="...">`
// before `%sveltekit.head%` in `app.html`, so it still runs before any
// stylesheet and the correct scheme is still on `<html>` for the very
// first paint — the one thing this file exists to guarantee. Storage key
// and values are duplicated from THEME_STORAGE_KEY/ThemePreference in
// `src/lib/theme.ts` on purpose: this script runs before a module graph
// exists, so it cannot import that module. `theme.test.ts` pins this
// literal to that constant so the two cannot drift apart. 'system' writes
// no attribute at all — prefers-color-scheme in palette.css/tokens.css
// keeps driving the scheme for that case, live, with no JS involved.
(function () {
	try {
		var stored = localStorage.getItem('mastro:theme');
		if (stored === 'light' || stored === 'dark') {
			document.documentElement.dataset.theme = stored;
		}
	} catch {
		// A browser that refuses localStorage (private mode, blocked storage)
		// simply gets the prefers-color-scheme default. Nothing to recover.
	}
})();
