// Prerendered so the service worker can precache it at install time
// alongside the build output (see $service-worker's `prerendered` array in
// src/service-worker.ts): its HTML exists on disk from the build, before
// any request — and so before any session — exists. That is what makes it
// safe to serve offline to a visitor the service worker cannot otherwise
// tell apart from a signed-out one (#61 — see the comment at the top of
// src/service-worker.ts for the full caching rule this follows).
export const prerender = true;
