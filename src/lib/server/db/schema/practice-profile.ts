import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

/**
 * The practice's own fiscal identity (#258): legal name, tax id (codice
 * fiscale), VAT number and registered address — the issuer block a
 * generated invoice needs on the practice's own side, symmetric to
 * `client`'s identity on the counterparty side. Does not carry a tax
 * regime code: that is the jurisdiction pack's own `taxRegimeCode` (#256),
 * not data about the practice itself (AGENTS.md invariant 1 — no
 * country-specific logic outside a pack; this table just holds whatever
 * national tax ids a self-hoster's own jurisdiction happens to use, the
 * same restraint `client.taxId`/`client.vatId` already keep).
 *
 * `vatId` is nullable, mirroring `client.vatId`: not every regime this
 * product might run under issues one. `taxId` is required — every legal
 * entity or person has some form of national tax id, which is what a
 * generated invoice's issuer block needs at minimum.
 *
 * Singleton by construction, not by application promise. `singleton` is
 * always `true` — enforced by the `practice_profile_singleton_true`
 * CHECK — and carries a UNIQUE constraint, so a second `INSERT` collides
 * on that same value instead of silently creating a second row. A plain
 * `unique()` on a real, always-constant column reads more directly than a
 * partial index on a fabricated expression, and — unlike a `smallint
 * PRIMARY KEY DEFAULT 1 CHECK (id = 1)` trick — keeps the `id`/timestamp
 * shape every other table in this schema carries (`columns.ts`), so a
 * repository reads it exactly the way it reads any other row by id.
 *
 * The repository (`repositories/practice-profile.ts`) never fabricates
 * this row: `getPracticeProfile` returns `undefined` on a fresh instance,
 * and every reader is expected to show that as a visible "not configured
 * yet" state rather than treat a null field as blank data.
 */
export const practiceProfile = pgTable(
	'practice_profile',
	{
		id: id(),
		legalName: text('legal_name').notNull(),
		taxId: text('tax_id').notNull(),
		vatId: text('vat_id'),
		country: text('country').notNull(),
		addressLine1: text('address_line1').notNull(),
		addressLine2: text('address_line2'),
		addressCity: text('address_city').notNull(),
		addressPostalCode: text('address_postal_code').notNull(),
		addressRegion: text('address_region'),
		singleton: boolean('singleton').notNull().default(true),
		...timestamps()
	},
	(table) => [
		check('practice_profile_singleton_true', sql`${table.singleton} = true`),
		unique('practice_profile_singleton_unique').on(table.singleton)
	]
);
