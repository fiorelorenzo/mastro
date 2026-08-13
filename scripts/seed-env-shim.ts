// Stands in for SvelteKit's `$env/dynamic/private` (`import { env } from
// '$env/dynamic/private'`) when the repository layer is loaded outside a
// SvelteKit process — see `seed-lib-resolve.ts` for why `seed-demo.ts` needs
// this at all. SvelteKit's own module reads `process.env` under the hood and
// hands back exactly this shape, so re-exporting it directly is a faithful
// stand-in, not an approximation.
export const env: NodeJS.ProcessEnv = process.env;
