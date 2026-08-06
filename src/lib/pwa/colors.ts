// Placeholder neutral surfaces for the manifest and the theme-color meta tags in
// +layout.svelte, until #56 lands the real light/dark palette. Tailwind's own
// neutral-50 and neutral-950 are used on purpose: they carry no hue, so they
// cannot be mistaken for an invented brand colour, and swapping in the real
// tokens once #56 defines them is a one-line change here (and a rerun of
// scripts/generate-pwa-assets.ts to refresh the committed manifest).
export const SURFACE_LIGHT = '#fafafa';
export const SURFACE_DARK = '#0a0a0a';
