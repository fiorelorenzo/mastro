// Regenerates every PWA asset committed to the repo — the icon set and the web
// app manifest — from the single source SVG in src/lib/assets/favicon.svg and
// the shared surface colours in src/lib/pwa/colors.ts. Run again whenever
// either of those changes, in particular once a real icon and the real
// palette from #56 exist:
//
//   node scripts/generate-pwa-assets.ts
//
// Runs under plain `node` (type stripping), same as scripts/migrate.ts, so it
// needs no build step. `sharp` is a devDependency only used here.
//
// The source SVG is a full-bleed square with no transparency, on purpose: the
// same artwork works unmodified as an "any" purpose icon, a "maskable" icon
// (its content already sits inside the 80% safe zone), and the opaque Apple
// touch icon iOS expects, without needing three separate designs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { log } from '../src/lib/server/log/logger.ts';
import { SURFACE_LIGHT } from '../src/lib/pwa/colors.ts';

const SOURCE_SVG = 'src/lib/assets/favicon.svg';
// The SVG's own width/height/viewBox. Density is computed relative to this so
// every output size rasterises directly at its target resolution, rather than
// being resized from a mismatched raster.
const SOURCE_SIZE = 512;
// Must match the source SVG's background <rect> fill: flatten() below is only a
// safety net against stray edge alpha from rasterising at a fractional density,
// and a mismatched colour would show as a fringe if that ever happens.
const ICON_BACKGROUND = '#171717';

interface IconSpec {
	file: string;
	size: number;
}

// Chromium's installability check requires an "any" 192 and a 512; a 512
// maskable is its own recommendation for the Android adaptive icon, and a 192
// maskable alongside it so the safe zone still holds at the smaller launcher
// density too. See https://web.dev/articles/add-manifest and
// https://web.dev/articles/maskable-icon.
const manifestIcons: IconSpec[] = [
	{ file: 'static/icons/icon-192.png', size: 192 },
	{ file: 'static/icons/icon-512.png', size: 512 },
	{ file: 'static/icons/icon-maskable-192.png', size: 192 },
	{ file: 'static/icons/icon-maskable-512.png', size: 512 }
];

// iOS has never read any of the above: a single 180x180 PNG at the fixed path
// Safari probes for is all it uses, scaling it down itself for older devices.
const appleTouchIcon: IconSpec = { file: 'static/apple-touch-icon.png', size: 180 };

async function renderIcon(source: Buffer, { file, size }: IconSpec): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const png = await sharp(source, { density: (72 * size) / SOURCE_SIZE })
		.resize(size, size)
		.flatten({ background: ICON_BACKGROUND })
		.png()
		.toBuffer();
	await writeFile(file, png);
	log.info('pwa asset written', { file, size });
}

async function writeManifest(): Promise<void> {
	const manifest = {
		id: '/',
		name: 'mastro',
		short_name: 'mastro',
		description: 'A ledger for days that must be approved before they are worked.',
		lang: 'en',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		// Placeholder neutral surfaces: see src/lib/pwa/colors.ts for why, and #56
		// for the real palette this will be replaced with.
		background_color: SURFACE_LIGHT,
		theme_color: SURFACE_LIGHT,
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{
				src: '/icons/icon-maskable-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'maskable'
			},
			{
				src: '/icons/icon-maskable-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			}
		]
	};
	const file = 'static/manifest.webmanifest';
	await writeFile(file, JSON.stringify(manifest, null, '\t') + '\n');
	log.info('pwa asset written', { file });
}

const source = await readFile(SOURCE_SVG);
for (const icon of [...manifestIcons, appleTouchIcon]) {
	await renderIcon(source, icon);
}
await writeManifest();
