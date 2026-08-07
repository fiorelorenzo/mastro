import { relations } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';

/**
 * A recorded reading of an ambiguous clause (#20). Real contract clauses
 * sometimes admit more than one honest reading — a renewal clause that
 * reads as both "ends unless the client elects to renew" and "either
 * party may refuse renewal with notice" in the same sentence — and the
 * system must not pretend to know which one governs. This table is where
 * the interpretation actually adopted is written down, next to the
 * verbatim text it was read from, so a later dispute is resolved by
 * rereading a decision instead of re-guessing one.
 *
 * Shown on the contract's own detail screen next to the fields the note
 * affects — renewal dates in particular, since that is the case the issue
 * itself is written around — not on a separate tab: this table carries no
 * `subject`/`appliesTo` classifier of its own, because the contract detail
 * screen has no tabs to bury a note in and the clause reference already
 * tells a human reader which field it is about.
 */
export const clauseNote = pgTable('clause_note', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'cascade' }),
	// e.g. "Art. 8.3" — freeform, since clause numbering follows whatever
	// convention the contract itself uses.
	clauseReference: text('clause_reference').notNull(),
	verbatimText: text('verbatim_text').notNull(),
	interpretationAdopted: text('interpretation_adopted').notNull(),
	notes: text('notes'),
	...timestamps()
});

export const clauseNoteRelations = relations(clauseNote, ({ one }) => ({
	contract: one(contract, { fields: [clauseNote.contractId], references: [contract.id] })
}));
