// Shared types for the recursive folder scan (#43). Isomorphic — this
// whole directory runs in the browser (the File System Access API and
// `<input webkitdirectory>` both only exist there), and is unit-tested from
// Node over a fixture tree by swapping in the Node-`fs` adapter defined in
// scan.test.ts, which satisfies the same structural interfaces as the real
// browser handles (see scan-source.ts).

/** A leaf file the scan produced, after any `.zip` it lived in was expanded
 * and any `.p7m` envelope around it was unwrapped. `path` is the full
 * virtual path for diagnostics — `archive.zip/inner/invoice.xml` for a file
 * that came out of a zip, the plain relative path otherwise — never used to
 * decide what a file is, only to explain to a human which physical file (or
 * archive member) a result came from. */
export interface ScannedFile {
	readonly path: string;
	readonly content: Uint8Array;
}

/** Reported as the scan proceeds so a large folder shows it is working
 * rather than appearing to hang (#43's third acceptance bullet).
 * `filesVisited` counts raw filesystem entries read so far, before any
 * expansion; `filesProduced` counts the leaf `ScannedFile`s produced so far
 * (a single zip visited once can produce many). */
export interface ScanProgress {
	readonly filesVisited: number;
	readonly filesProduced: number;
}

export type ScanProgressListener = (progress: ScanProgress) => void;
