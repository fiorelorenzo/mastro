import { relations, sql } from 'drizzle-orm';
import { boolean, check, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

/**
 * The channel through which this client's legal notices (renewal refusal,
 * termination) are sent and received. Approval channel is a per-contact
 * concern (see `clientContact.canApprove`); this is the channel the client
 * as a whole has agreed carries legal weight.
 */
export const noticeChannel = pgEnum('notice_channel', [
	'email',
	'certified_mail',
	'registered_mail',
	'courier',
	'other'
]);
export type NoticeChannel = (typeof noticeChannel.enumValues)[number];

/**
 * A client is not just a name: legal identity for invoicing (`legalName`,
 * `taxId`, `vatId`), a registered address kept in separate columns because
 * it is compared, part by part, against invoice documents pulled in on
 * import, and the channel that carries legal weight for notices.
 *
 * `country` is the client's country of legal domicile (ISO 3166-1 alpha-2).
 * The registered address is assumed to sit in that same country: this
 * schema does not model a client whose registered office is abroad, which
 * none of the three founding archetypes need.
 */
export const client = pgTable(
	'client',
	{
		id: id(),
		legalName: text('legal_name').notNull(),
		/**
		 * Unique, and optional. Import matching keys on it to find the client
		 * an incoming invoice document belongs to, so a client that has one
		 * is still matched exactly — but requiring it made the row
		 * unrecordable before anyone knew it, and the way around that was to
		 * invent a value, which then travels onto an invoice.
		 *
		 * `UNIQUE` survives the nullability for free: Postgres does not treat
		 * two `NULL`s as equal, so any number of clients without a tax id
		 * coexist while two sharing a real one are still refused by the
		 * database rather than by an application check. `matchClientByTaxId`
		 * carries the other half of that rule — an absent tax id matches
		 * nothing, including another absent one.
		 */
		taxId: text('tax_id').unique(),
		vatId: text('vat_id'),
		country: text('country').notNull(),
		addressLine1: text('address_line1'),
		addressLine2: text('address_line2'),
		addressCity: text('address_city'),
		addressPostalCode: text('address_postal_code'),
		addressRegion: text('address_region'),
		/**
		 * Empty until somebody knows the answer. Nothing reads this column to
		 * decide anything today, and two places used to *write* it without
		 * being told — `applyProposal` and `buildClientContractProposal` both
		 * defaulted it to `'email'`, the latter with a comment admitting that
		 * an invoice reveals nothing about how a client prefers to receive a
		 * legal notice. A notice-sending surface does not exist yet; when it
		 * does it must require this field, which is a better place for the
		 * question than a form nobody can get past.
		 */
		noticeChannel: noticeChannel('notice_channel'),
		/**
		 * FatturaPA's `CodiceDestinatario` (#259): the 7-character code SdI
		 * routes this client's e-invoices to. Optional — most clients
		 * never carry one until the self-hoster collects it, and none
		 * outside Italy's SdI network ever will.
		 */
		sdiCode: text('sdi_code'),
		/**
		 * FatturaPA's `PECDestinatario` (#259): the client's certified-mail
		 * address, SdI's fallback route when `sdiCode` is absent. Neither
		 * present routes to the legally valid but silent `'0000000'` case
		 * — see `resolveInvoiceRouting` in `domain/invoice.ts`.
		 */
		pecAddress: text('pec_address'),
		...timestamps()
	},
	(table) => [
		check(
			'client_sdi_code_length',
			sql`${table.sdiCode} is null or char_length(${table.sdiCode}) = 7`
		),
		check(
			'client_pec_address_is_email',
			sql`${table.pecAddress} is null or ${table.pecAddress} ~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'`
		)
	]
);

/**
 * A person at the client. `canApprove` is what makes an approval sent from
 * this contact count; a contact without it can still be a routine sender
 * (invoices, day-to-day correspondence) but their say-so on a day is not
 * proof of anything.
 */
export const clientContact = pgTable('client_contact', {
	id: id(),
	clientId: uuid('client_id')
		.notNull()
		.references(() => client.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	email: text('email').notNull(),
	phone: text('phone'),
	role: text('role'),
	canApprove: boolean('can_approve').notNull().default(false),
	...timestamps()
});

export const clientRelations = relations(client, ({ many }) => ({
	contacts: many(clientContact)
}));

export const clientContactRelations = relations(clientContact, ({ one }) => ({
	client: one(client, { fields: [clientContact.clientId], references: [client.id] })
}));
