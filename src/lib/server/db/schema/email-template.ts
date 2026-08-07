import { relations } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';

/**
 * The placeholders `renderTemplate` (`src/lib/server/mail/render.ts`)
 * substitutes, named after the epic's own list. `period`, `dayList` and
 * `dayTotal` come from the day register the contract's ledger produces for
 * the send (#70); `invoiceNumber`, `amount` and `dueDate` come from the
 * neutral `Invoice` shape in `src/lib/server/import/invoice.ts` — #26 turns
 * that into the `invoice` table this wave, so until a persisted invoice
 * exists to read, a caller supplies this context by hand (see
 * `EmailTemplateContext` in `src/lib/server/mail/render.ts`).
 */
export const EMAIL_TEMPLATE_PLACEHOLDERS = [
	'invoice_number',
	'period',
	'amount',
	'due_date',
	'day_list',
	'day_total'
] as const;
export type EmailTemplatePlaceholder = (typeof EMAIL_TEMPLATE_PLACEHOLDERS)[number];

/**
 * When a draft should be produced. `on_issue` and `days_before_due` name
 * events on the invoice lifecycle (#26, out of scope here) — this field
 * only records the intent. Nothing in this wave schedules a job against
 * it: there is no `invoice` table yet to react to, and building that
 * reaction is a future issue's job, not a silent addition to this one.
 * `manual` is the only trigger this wave can act on end to end, from the
 * compose screen (#72).
 */
export type EmailTemplateTrigger =
	{ kind: 'on_issue' } | { kind: 'days_before_due'; days: number } | { kind: 'manual' };

/**
 * What `src/lib/server/mail/attachments.ts` can assemble fresh from the
 * ledger at send time. A plain CHECK-constrained text array, not a pg
 * enum — the same choice `document.ownerType` made, and for the same
 * reason: the epic also names the invoice PDF (#26, another agent's table
 * this wave) and receipts for rebilled expenses (no `expense` table yet)
 * as attachments, and widening a CHECK constraint's allowed values later
 * is metadata-only, unlike `ALTER TYPE ... ADD VALUE`. Both land here the
 * day their source table exists to generate them from.
 */
export const EMAIL_ATTACHMENT_KINDS = ['day_register_pdf', 'day_register_csv'] as const;
export type EmailAttachmentKind = (typeof EMAIL_ATTACHMENT_KINDS)[number];

/**
 * Per contract (epic #12): subject and body with placeholders, a
 * configurable attachment set assembled fresh at send time (never stored
 * stale — #71's acceptance), and a trigger recording when a draft should
 * be produced. `subject`/`body` are validated against
 * `EMAIL_TEMPLATE_PLACEHOLDERS` before they are ever written — see
 * `src/lib/server/mail/placeholders.ts` and
 * `src/lib/server/repositories/email-template-form.ts` — so an unknown
 * `{{...}}` fails the save, never the send.
 */
export const emailTemplate = pgTable('email_template', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	name: text('name').notNull(),
	subject: text('subject').notNull(),
	body: text('body').notNull(),
	attachmentKinds: text('attachment_kinds').array().notNull().$type<EmailAttachmentKind[]>(),
	trigger: jsonb('trigger').$type<EmailTemplateTrigger>().notNull(),
	...timestamps()
});

export const emailTemplateRelations = relations(emailTemplate, ({ one }) => ({
	contract: one(contract, { fields: [emailTemplate.contractId], references: [contract.id] })
}));

/**
 * One send, logged after the fact for audit — the only irreversible
 * outward-facing operation in the product (epic #12) is worth a durable
 * record even though nothing queries it back yet. `messageId` is the
 * `Message-ID` header of the sent message, the same value the IMAP append
 * writes to the Sent folder, so a support question ("did this go out?")
 * has one answer to check against two systems.
 */
export const sentEmail = pgTable('sent_email', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	emailTemplateId: uuid('email_template_id')
		.notNull()
		.references(() => emailTemplate.id, { onDelete: 'restrict' }),
	recipients: jsonb('recipients').$type<string[]>().notNull(),
	subject: text('subject').notNull(),
	messageId: text('message_id').notNull(),
	autoSent: boolean('auto_sent').notNull(),
	...timestamps()
});

export const sentEmailRelations = relations(sentEmail, ({ one }) => ({
	contract: one(contract, { fields: [sentEmail.contractId], references: [contract.id] }),
	emailTemplate: one(emailTemplate, {
		fields: [sentEmail.emailTemplateId],
		references: [emailTemplate.id]
	})
}));
