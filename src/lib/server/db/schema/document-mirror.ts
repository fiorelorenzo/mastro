import { relations } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { document } from './document';

export const documentMirrorRunStatus = pgEnum('document_mirror_run_status', ['success', 'failure']);
export type DocumentMirrorRunStatus = (typeof documentMirrorRunStatus.enumValues)[number];

/**
 * One row per publish attempt to a configured `MirrorTarget` (#50),
 * `src/lib/server/drive/publish.ts` writes exactly one of these after
 * every attempt, success or failure — the same shape `backup_run` (#77)
 * established for the alert engine (#74, not built yet) to poll: a
 * `failure` row nobody has acknowledged is the signal, `acknowledged_at`
 * starting null is how a future alert UI silences one without deleting
 * the record of it. See `backup.ts` for the query shape #74 is meant to
 * run; the same two-part check (an unacknowledged failure, or staleness —
 * no successful run recently for a document sitting unmirrored) applies
 * here once #74 exists.
 *
 * This table is the only thing that makes a failed publish visible: a
 * `MirrorTarget.publish()` that throws is caught by `publishDocument`
 * and never propagates past it as an unhandled rejection nobody sees.
 */
export const documentMirrorRun = pgTable('document_mirror_run', {
	id: id(),
	documentId: uuid('document_id')
		.notNull()
		.references(() => document.id, { onDelete: 'cascade' }),
	status: documentMirrorRunStatus('status').notNull(),
	detail: text('detail'),
	acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
	...timestamps()
});

export const documentMirrorRunRelations = relations(documentMirrorRun, ({ one }) => ({
	document: one(document, { fields: [documentMirrorRun.documentId], references: [document.id] })
}));
