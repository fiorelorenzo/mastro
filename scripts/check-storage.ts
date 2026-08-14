// Refuses to start the server when it cannot write archived documents.
//
// Invariant 4 in AGENTS.md: every derived datum keeps its source document.
// The document root is a bind mount, and unlike a named volume Docker does
// not copy the image's ownership onto one — it hands the host directory to
// the container exactly as it found it. A host path that does not exist
// yet is created by Docker as root:root, and this image runs as non-root
// `mastro`, so on a fresh install the very first archived approval fails
// with EACCES: the ledger keeps the row and loses the proof, which is
// precisely the trade invariant 4 exists to forbid.
//
// Failing at boot turns that into a container that will not start and says
// why. Runs before migrations for a reason: an operator fixing two things
// should be told about both on the first attempt, and this check costs a
// stat and a write.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.env.DOCUMENT_STORAGE_ROOT ?? './data/documents';
const probe = join(root, '.write-probe');

try {
	await mkdir(root, { recursive: true, mode: 0o700 });
	await writeFile(probe, '', { mode: 0o600 });
	await rm(probe, { force: true });
} catch (error) {
	const reason = error instanceof Error ? error.message : String(error);
	process.stderr.write(
		`mastro: cannot write archived documents to ${root}\n` +
			`  ${reason}\n\n` +
			`This process runs as uid ${process.getuid?.() ?? '?'}, and the document root is a\n` +
			`bind mount whose ownership comes from the host, not from the image. Create it\n` +
			`on the host owned by that uid before starting the stack:\n\n` +
			`  mkdir -p "$DOCUMENTS_DIR" && sudo chown ${process.getuid?.() ?? 100}:${process.getgid?.() ?? 101} "$DOCUMENTS_DIR"\n\n` +
			`Refusing to start: an instance that cannot archive a document would keep the\n` +
			`extracted row and lose the proof behind it (invariant 4, docs/backup.md).\n`
	);
	process.exit(1);
}
