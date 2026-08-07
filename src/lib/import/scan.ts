// The recursive folder scan (#43): ties the directory walk (scan-source.ts)
// to the zip/p7m expansion (expand.ts) and reports progress as it goes, so
// a large folder shows it is working rather than appearing to hang.

import { expandEntry } from './expand';
import {
	rawEntriesFromFileList,
	walkDirectoryHandle,
	type RawEntry,
	type ScanDirectoryHandle,
	type ScanFile
} from './scan-source';
import type { ScannedFile, ScanProgressListener } from './types';

async function scanEntries(
	entries: AsyncIterable<RawEntry> | Iterable<RawEntry>,
	onProgress?: ScanProgressListener
): Promise<ScannedFile[]> {
	const produced: ScannedFile[] = [];
	let filesVisited = 0;
	for await (const entry of entries) {
		filesVisited++;
		const content = await entry.bytes();
		produced.push(...(await expandEntry(entry.path, content)));
		onProgress?.({ filesVisited, filesProduced: produced.length });
	}
	return produced;
}

/** Scans a directory picked through the File System Access API
 * (`window.showDirectoryPicker()`). */
export function scanDirectoryHandle(
	root: ScanDirectoryHandle,
	onProgress?: ScanProgressListener
): Promise<ScannedFile[]> {
	return scanEntries(walkDirectoryHandle(root), onProgress);
}

/** Scans the flat `FileList` an `<input webkitdirectory>` fallback
 * produces. */
export function scanFileList(
	files: Iterable<ScanFile>,
	onProgress?: ScanProgressListener
): Promise<ScannedFile[]> {
	return scanEntries(rawEntriesFromFileList(files), onProgress);
}

export type { ScanDirectoryHandle, ScanFile, ScanFileHandle } from './scan-source';
export type { ScannedFile, ScanProgress, ScanProgressListener } from './types';
