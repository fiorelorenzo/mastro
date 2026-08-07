// The two real sources of files a folder import can start from (#43): the
// File System Access API's directory picker, and the `<input
// webkitdirectory>` fallback for browsers without it. Both reduce to the
// same minimal shape below, which is also exactly what a real
// `FileSystemDirectoryHandle`/`FileSystemFileHandle` already look like — so
// passing one of those in satisfies this interface structurally, with no
// DOM-lib dependency in this file, and a test can hand in an adapter over
// plain Node `fs` instead (see scan.test.ts) to walk a real fixture tree
// without a browser.

export interface ScanFileHandle {
	readonly kind: 'file';
	readonly name: string;
	getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface ScanDirectoryHandle {
	readonly kind: 'directory';
	readonly name: string;
	values(): AsyncIterable<ScanFileHandle | ScanDirectoryHandle>;
}

/** A raw file entry as read off the tree, before any `.zip`/`.p7m`
 * expansion. `bytes` is lazy so a directory with many entries does not read
 * every file into memory before the caller has processed the first one. */
export interface RawEntry {
	readonly path: string;
	readonly bytes: () => Promise<Uint8Array>;
}

/** Recursively walks `dir`, yielding one `RawEntry` per file, depth first.
 * Directory names become path segments (`sub/deeper/file.txt`) purely for
 * diagnostics — nothing here inspects a name to decide anything. */
export async function* walkDirectoryHandle(
	dir: ScanDirectoryHandle,
	prefix = ''
): AsyncGenerator<RawEntry> {
	for await (const entry of dir.values()) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.kind === 'directory') {
			yield* walkDirectoryHandle(entry, path);
		} else {
			yield {
				path,
				bytes: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer())
			};
		}
	}
}

/** A minimal structural subset of the DOM `File` type — declared locally so
 * this file has no `lib.dom` dependency and still accepts a real `File`. */
export interface ScanFile {
	readonly name: string;
	/** Present on every real `File` (and on `FileSystemFileHandle.getFile()`
	 * results) as `webkitRelativePath` when it came from a `webkitdirectory`
	 * input; empty otherwise, e.g. a flat file list. */
	readonly webkitRelativePath?: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** The `<input webkitdirectory>` fallback: the browser already flattens the
 * whole tree into a `FileList`, each entry carrying its own relative path,
 * so no recursive walk is needed here — only the same lazy `RawEntry`
 * shape the directory-handle path produces. */
export function rawEntriesFromFileList(files: Iterable<ScanFile>): RawEntry[] {
	return Array.from(files, (file) => ({
		path: file.webkitRelativePath || file.name,
		bytes: async () => new Uint8Array(await file.arrayBuffer())
	}));
}
