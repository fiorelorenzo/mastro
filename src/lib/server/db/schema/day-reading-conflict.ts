import { date, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';
import { document } from './document';
import { extractionRun } from './extraction-run';

/**
 * A reading of the mail that disagrees with what the ledger holds for a day.
 *
 * The producer discovers the disagreement in a moment that then passes, and
 * the alert engine is detectors querying the database — it cannot re-invoke
 * the model to rediscover it. So the reading is written down here, the same
 * shape `backup_run` and `document_mirror_run` already have: an alert whose
 * evidence is a row on a table of its own.
 *
 * One row per `(contract_id, date)`, upserted: the newest reading supersedes
 * the previous one, because what a reviewer needs is what the mail says now.
 * `proposed_fields` null means the newest reading proposes **nothing** for
 * that date — the client cancelled the day — which is a disagreement too.
 *
 * No `acknowledged_at`. Acknowledgement belongs to the alert engine, keyed by
 * `alertKey` (`alert_acknowledgement`), and a second kind of acknowledge
 * button is the mistake that table's own doc comment exists to prevent.
 */
export const dayReadingConflict = pgTable(
	'day_reading_conflict',
	{
		id: id(),
		contractId: uuid('contract_id')
			.notNull()
			.references(() => contract.id, { onDelete: 'restrict' }),
		date: date('date').notNull(),
		documentId: uuid('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'restrict' }),
		extractionRunId: uuid('extraction_run_id').references(() => extractionRun.id, {
			onDelete: 'restrict'
		}),
		proposedFields: jsonb('proposed_fields'),
		excerpt: text('excerpt'),
		...timestamps()
	},
	(table) => [unique('day_reading_conflict_contract_date_key').on(table.contractId, table.date)]
);
