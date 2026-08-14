import type { MinorUnits } from '$lib/money';
import type { DocumentProvenance, NoticeChannel } from '$lib/server/db/schema';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';
import type { RegisterEntry } from '$lib/server/register/types';

/**
 * What #214 says an argument actually needs, assembled around one disputed
 * (or once-disputed) day: the approval and its verbatim excerpt, the
 * archived original that approval rests on, the register entry for the
 * month the day falls in, every clause note recorded against the contract
 * (`clause_note` carries no classifier of its own — see that schema's own
 * comment — so "the one that governs it" is read by a human off its own
 * `clauseReference`, not picked by this bundle), and the invoice line the
 * day landed on. Any of these can be `null`/empty and the bundle still
 * renders — honestly stating "none on file" is itself information
 * (`SourceDocument.svelte`'s own reasoning) — except `document`, which
 * invariant 4 exists to make sure is never silently missing when an
 * `approval` names one.
 */
export interface DisputeBundle {
	readonly workUnitId: string;
	/** ISO date, e.g. `'2026-06-01'`. */
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly state: WorkUnitState;
	readonly contract: {
		readonly id: string;
		readonly title: string;
		readonly clientName: string;
		readonly currency: string;
		readonly templateLanguage: 'en' | 'it';
	};
	readonly approval: {
		readonly id: string;
		readonly channel: NoticeChannel;
		readonly sender: string;
		readonly receivedAt: Date;
		readonly messageId: string | null;
		readonly excerpt: string;
	} | null;
	/** The archived original behind `approval` — `null` exactly when
	 *  `approval` is, since `approval.documentId` is `NOT NULL` in the
	 *  schema (every approval that exists names one). */
	readonly document: {
		readonly id: string;
		readonly hash: string;
		readonly mime: string;
		readonly originalName: string;
		readonly provenance: DocumentProvenance;
		readonly createdAt: Date;
	} | null;
	readonly register: {
		readonly from: string;
		readonly to: string;
		/** This day's own row in that period's register, or `null` when the
		 *  day does not qualify for one — no approval on file, the same
		 *  exclusion `buildRegister` itself applies via its `INNER JOIN`. */
		readonly entry: RegisterEntry | null;
		readonly totalQuantity: number;
	};
	readonly clauseNotes: readonly {
		readonly id: string;
		readonly clauseReference: string;
		readonly verbatimText: string;
		readonly interpretationAdopted: string;
	}[];
	readonly invoiceLine: {
		readonly invoiceId: string;
		readonly invoiceNumber: string;
		readonly lineDescription: string;
		readonly amount: MinorUnits;
		readonly currency: string;
	} | null;
}
