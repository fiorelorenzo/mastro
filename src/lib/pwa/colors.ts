// Theme colours for the manifest and for the theme-color meta tags in
// +layout.svelte. They are the page surfaces from the design palette (#56), not
// a second set of values: an installed app whose chrome does not match the page
// it frames looks broken, and two sources for one colour drift.
//
// The generator script imports this module directly under plain node, so keep
// the import relative and the module free of anything Vite has to resolve.
import { surface } from '../design/palette.ts';

export const SURFACE_LIGHT = surface('light').page;
export const SURFACE_DARK = surface('dark').page;
