import { relations, sql } from 'drizzle-orm';
import {
	bigserial,
	date,
	index,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { approval } from './approval';
import { contract } from './contract';
import { invoiceLine } from './invoice';

/**
 * The day lifecycle described on epic #2:
 *
 * ```
 *   proposed --> approved --> worked --> invoiced --> paid
 *       |            |           |           |
 *       |            |           |           +--> disputed --(resolved)--> invoiced
 *       |            +--> revoked            |
 *       +--> rejected                        |
 *   worked_without_approval --(late approval)--> worked
 *                           +--(no recovery)---> unbillable
 * ```
 *
 * The accompanying custom migration enforces every edge above at the
 * database level (#21): which transitions are legal, that `approved` (and
 * everything after it) needs an `approval_id` on a contract that requires
 * one, and that a day recorded `worked` on such a contract with no
 * approval lands in `worked_without_approval` automatically (#23) — never
 * as an application-layer decision a future write path could skip.
 */
export const workUnitState = pgEnum('work_unit_state', [
	'proposed',
	'approved',
	'worked',
	'worked_without_approval',
	'invoiced',
	'paid',
	'disputed',
	'revoked',
	'rejected',
	'unbillable'
]);
export type WorkUnitState = (typeof workUnitState.enumValues)[number];

/**
 * One day (or fraction of one) of billable work. `quantity` is 1.0 (a full
 * day), 0.5 (half a day), or an hours figure on an hourly rate card — which
 * one applies is resolved against the contract's rate card at pricing
 * time, not validated here. `approvalId` is the proof this day was
 * authorised in writing before it was worked (#22); `invoiceLineId` is
 * where it lands once billed (#26) — restricted, not cascaded, the same
 * choice `approvalId` makes: a line cannot be deleted out from under a
 * day that is already `invoiced` or `paid`.
 */
export const workUnit = pgTable('work_unit', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	date: date('date').notNull(),
	quantity: numeric('quantity', { precision: 6, scale: 2, mode: 'number' }).notNull(),
	scope: text('scope').notNull(),
	state: workUnitState('state').notNull().default('proposed'),
	approvalId: uuid('approval_id').references(() => approval.id, { onDelete: 'restrict' }),
	invoiceLineId: uuid('invoice_line_id').references(() => invoiceLine.id, { onDelete: 'restrict' }),
	notes: text('notes'),
	...timestamps()
});

/** Who made a transition happen. `human` names the account by email
 * (Better Auth has no other stable, human-readable identifier at hand);
 * `agent` names the accepted proposal it followed (invariant 3: the ACP
 * runner itself never writes here, a human always confirmed first);
 * `system` is the database's own automatic transitions — the #23 redirect
 * into `worked_without_approval` and the recovery out of it. */
export type TransitionActor =
	| { kind: 'human'; email: string }
	| { kind: 'agent'; proposalReference: string }
	| { kind: 'system' };

/**
 * Append-only (#21): every state change, who made it and why, enforced in
 * the database by a trigger in the accompanying custom migration, the same
 * way `approval` enforces its own immutability. Rows are written by a
 * trigger on `work_unit` itself (`work_unit_log_transition`), not by
 * application code, so no write path — including a future import or the
 * ACP runner — can produce a state change this table does not see.
 */
export const workUnitTransition = pgTable(
	'work_unit_transition',
	{
		id: id(),
		workUnitId: uuid('work_unit_id')
			.notNull()
			.references(() => workUnit.id, { onDelete: 'restrict' }),
		fromState: workUnitState('from_state'),
		toState: workUnitState('to_state').notNull(),
		actor: jsonb('actor').$type<TransitionActor>().notNull(),
		reason: text('reason').notNull(),
		...timestamps(),
		// The one column in the schema that does not take `timestamps()`'s
		// `now()`. This is a log, so its order is its insertion order, and
		// `now()` is frozen for the whole transaction: every transition written
		// by one transaction shared a single value, and the query that renders
		// the day detail's history orders by this column alone, so a lifecycle
		// could display backwards (migration `0079` has the measurements).
		// `clock_timestamp()` is the real clock at each INSERT. Overridden here
		// rather than only in SQL because the generator models column defaults:
		// left to `timestamps()`, the next `db:generate` would emit an ALTER
		// putting `now()` back, and the flake with it.
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
		// #420: `created_at` (above) records *when* a transition was written,
		// not the order it was written in. `clock_timestamp()` can repeat
		// within a single statement, so a bulk UPDATE touching several work
		// units at once (one row-trigger firing per row) can still tie. `seq`
		// is a database sequence (`bigserial`): `nextval()` is guaranteed
		// unique and strictly increasing across every row of the table,
		// including several rows produced by one statement, because it does
		// not read the clock at all. `listWorkUnitTransitions` orders by this
		// column, not `created_at`.
		seq: bigserial('seq', { mode: 'bigint' }).notNull()
	},
	(table) => [index('work_unit_transition_work_unit_id_seq_idx').on(table.workUnitId, table.seq)]
);

export const workUnitRelations = relations(workUnit, ({ one, many }) => ({
	contract: one(contract, { fields: [workUnit.contractId], references: [contract.id] }),
	approval: one(approval, { fields: [workUnit.approvalId], references: [approval.id] }),
	invoiceLine: one(invoiceLine, { fields: [workUnit.invoiceLineId], references: [invoiceLine.id] }),
	transitions: many(workUnitTransition)
}));

export const workUnitTransitionRelations = relations(workUnitTransition, ({ one }) => ({
	workUnit: one(workUnit, { fields: [workUnitTransition.workUnitId], references: [workUnit.id] })
}));
