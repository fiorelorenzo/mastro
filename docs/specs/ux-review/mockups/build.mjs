// Assembles the fragments in this folder into one self-contained index.html.
// Run: node docs/specs/ux-review/mockups/build.mjs
//
// With `--inline` it also writes mastro-mockup.html, the same page with the
// two woff2 faces base64'd into the stylesheet — one file to hand to
// someone, openable by double-click with no folder and no network.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), 'utf8');

const fragments = readdirSync(here)
	.filter((f) => /^\d\d-.*\.html$/.test(f))
	.sort();

const screens = fragments.map((f) => read(f)).join('\n\n');
const titles = fragments.map((f) => {
	const src = read(f);
	const id = src.match(/id="([^"]+)"/)?.[1] ?? f;
	const label = src.match(/<h2>([^<]+)<\/h2>/)?.[1] ?? id;
	return { id, label };
});

const html = `<!doctype html>
<html lang="it" data-dir="b2" data-scheme="light">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>mastro — mockup delle tre direzioni</title>
		<style>
${read('fonts.css')}
${read('system.css')}
		</style>
	</head>
	<body>
		<header class="g-bar">
			<strong>mastro · mockup</strong>
			<div class="inline">
				<span class="stat-label">Direzione</span>
				<div class="seg" role="group" aria-label="Direzione visiva">
					<button type="button" data-set-dir="b1" aria-pressed="false">B1 Ledger</button>
					<button type="button" data-set-dir="b2" aria-pressed="true">B2 Plex</button>
					<button type="button" data-set-dir="b3" aria-pressed="false">B3 Console</button>
				</div>
			</div>
			<div class="inline">
				<span class="stat-label">Tema</span>
				<div class="seg" role="group" aria-label="Tema">
					<button type="button" data-set-scheme="light" aria-pressed="true">Chiaro</button>
					<button type="button" data-set-scheme="dark" aria-pressed="false">Scuro</button>
				</div>
			</div>
			<nav class="inline" style="gap: var(--space-1)">
				${titles.map((t) => `<a class="btn btn--sm btn--ghost" href="#${t.id}">${t.label}</a>`).join('\n\t\t\t\t')}
			</nav>
			<span class="faint" style="font-size: var(--text-xs); margin-left: auto">
				dati reali dell'istanza di prova · oggi = 13 agosto 2026
			</span>
		</header>

		<main class="g-main">
			<section class="g-screen">
				<h2 style="font-size: var(--text-2xl)">Tre direzioni, lo stesso prodotto</h2>
				<p class="g-note">
					Ogni schermata qui sotto è markup reale, non un'immagine. I tre bottoni in alto
					cambiano solo i token (carattere, colore, densità, raggio, ombra): il markup non si
					muove di una riga. È esattamente il modo in cui verrebbe costruito, quindi quello che
					vedi è quello che si ottiene.
				</p>
				<div class="grid cols-3">
					<div class="card">
						<h3>B1 · Ledger</h3>
						<p class="subtitle" style="margin-top: var(--space-2)">
							Carattere di sistema, quasi monocromatico, superfici piatte, righe da 36px. Il
							look di oggi fatto bene: nessun font da caricare, nessuna ombra, la sobrietà di
							un documento contabile ben impaginato.
						</p>
					</div>
					<div class="card">
						<h3>B2 · Ledger with confidence</h3>
						<p class="subtitle" style="margin-top: var(--space-2)">
							IBM Plex Sans per l'interfaccia e IBM Plex Mono per denaro, date e numeri di
							riferimento. Gerarchia di superfici vera, ombra morbida, raggio 10px, righe da
							44px. Il più lontano dall'aspetto attuale.
						</p>
					</div>
					<div class="card">
						<h3>B3 · Console</h3>
						<p class="subtitle" style="margin-top: var(--space-2)">
							Tutto monospaziato, scuro come default, righe da 32px, contrasto alto e
							scorciatoie da tastiera in primo piano. Denso: ci sta molto di più in una
							schermata, e chiede occhi allenati.
						</p>
					</div>
				</div>
			</section>

${screens}
		</main>

		<script>
			const root = document.documentElement;
			const sync = (attr, value) => {
				root.setAttribute(attr, value);
				try {
					localStorage.setItem('mockup:' + attr, value);
				} catch {}
				for (const b of document.querySelectorAll('[data-set-' + attr.slice(5) + ']')) {
					b.setAttribute(
						'aria-pressed',
						String(b.dataset[attr === 'data-dir' ? 'setDir' : 'setScheme'] === value)
					);
				}
			};
			for (const b of document.querySelectorAll('[data-set-dir]')) {
				b.addEventListener('click', () => sync('data-dir', b.dataset.setDir));
			}
			for (const b of document.querySelectorAll('[data-set-scheme]')) {
				b.addEventListener('click', () => sync('data-scheme', b.dataset.setScheme));
			}
			try {
				const d = localStorage.getItem('mockup:dir');
				const s = localStorage.getItem('mockup:scheme');
				if (d) sync('data-dir', d);
				if (s) sync('data-scheme', s);
			} catch {}
			// Keyboard: 1/2/3 switch direction, d toggles the scheme.
			addEventListener('keydown', (e) => {
				if (e.target.matches('input, textarea, select')) return;
				if (e.key === '1') sync('data-dir', 'b1');
				if (e.key === '2') sync('data-dir', 'b2');
				if (e.key === '3') sync('data-dir', 'b3');
				if (e.key.toLowerCase() === 'd')
					sync('data-scheme', root.getAttribute('data-scheme') === 'dark' ? 'light' : 'dark');
			});
		</script>
	</body>
</html>
`;

writeFileSync(join(here, 'index.html'), html);
console.log(`index.html: ${fragments.length} fragments, ${(html.length / 1024).toFixed(0)} KB`);

if (process.argv.includes('--inline')) {
	const inlined = html.replace(/url\(fonts\/([^)]+)\)/g, (_, file) => {
		const b64 = readFileSync(join(here, 'fonts', file)).toString('base64');
		return `url(data:font/woff2;base64,${b64})`;
	});
	writeFileSync(join(here, 'mastro-mockup.html'), inlined);
	console.log(`mastro-mockup.html: single file, ${(inlined.length / 1024).toFixed(0)} KB`);
}
