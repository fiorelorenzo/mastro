// Orchestrates one send (#72): render the template, assemble attachments
// fresh, compose the RFC 822 message once, send it, append it to Sent,
// and log it. `prepareEmail` and `dispatchEmail` are split deliberately —
// the compose screen calls `prepareEmail` to show the human a preview,
// then `dispatchEmail` only once they click send; nothing in between
// stores the draft anywhere a second call could go stale from.
import { db, type DbExecutor } from '$lib/server/db';
import { sentEmail, type EmailAttachmentKind } from '$lib/server/db/schema';
import { assembleAttachments, type EmailAttachment } from './attachments';
import type { MailConfig } from './config';
import { composeMessage } from './message';
import { renderTemplate, type EmailTemplateContext } from './render';
import { gmailSenderConfigFromEnv, sendComposedMessage } from './sender';

export type PreparedSend = {
	contractId: string;
	emailTemplateId: string;
	/** The invoice this send was about (#230), or `null` for a template
	 * whose context genuinely has none — every caller today always has
	 * one, but this stays optional rather than widening every context
	 * builder to fabricate an id nothing backs. */
	invoiceId: string | null;
	to: readonly string[];
	subject: string;
	body: string;
	attachments: EmailAttachment[];
};

/** Renders the template and assembles its attachments against `context` —
 * the same preview shown to the human before anything leaves (#72's
 * acceptance). Never sends anything itself. `invoiceId` is carried
 * through to `dispatchEmail`'s log, not read here — nothing in this
 * function's own job (rendering, assembling attachments) needs it. */
export async function prepareEmail(
	template: {
		id: string;
		contractId: string;
		subject: string;
		body: string;
		attachmentKinds: EmailAttachmentKind[];
	},
	context: EmailTemplateContext,
	to: readonly string[],
	invoiceId: string | null,
	executor: DbExecutor = db
): Promise<PreparedSend> {
	const rendered = renderTemplate(template, context);
	const attachments = await assembleAttachments(
		template.attachmentKinds,
		template.contractId,
		context.period,
		context.language,
		executor
	);
	return {
		contractId: template.contractId,
		emailTemplateId: template.id,
		invoiceId,
		to,
		subject: rendered.subject,
		body: rendered.body,
		attachments
	};
}

export type SendResult = { messageId: string; sentAt: Date };

/** The only function that actually sends: composes `prepared` into one
 * RFC 822 message, sends it over SMTP, appends the same bytes to the
 * user's Sent folder over IMAP, and logs the send. This is the explicit
 * action #72 requires — the compose screen calls it only from the
 * "Send" button, never from the preview render. */
export async function dispatchEmail(
	prepared: PreparedSend,
	mailConfig: MailConfig,
	autoSent: boolean,
	executor: DbExecutor = db
): Promise<SendResult> {
	const message = await composeMessage({
		from: { address: mailConfig.smtp.fromAddress, name: mailConfig.smtp.fromName },
		to: prepared.to,
		subject: prepared.subject,
		body: prepared.body,
		attachments: prepared.attachments
	});

	// #345: the Gmail API when this host cannot reach an SMTP port,
	// otherwise SMTP. `sendComposedMessage` also owns whether a copy has to
	// be appended to Sent, because that depends on which sender ran.
	const gmail = gmailSenderConfigFromEnv();
	await sendComposedMessage(
		gmail ? { kind: 'gmail_api', gmail } : { kind: 'smtp', smtp: mailConfig.smtp },
		mailConfig.imap,
		message
	);

	const [row] = await executor
		.insert(sentEmail)
		.values({
			contractId: prepared.contractId,
			emailTemplateId: prepared.emailTemplateId,
			invoiceId: prepared.invoiceId,
			recipients: [...prepared.to],
			subject: prepared.subject,
			messageId: message.messageId,
			autoSent
		})
		.returning();

	return { messageId: message.messageId, sentAt: row.createdAt };
}

export type AutomaticSendResult = ({ sent: true } & SendResult) | { sent: false };

/**
 * What a scheduler would call for a non-manual trigger once one exists
 * (#26's invoice lifecycle — `on_issue`/`days_before_due` firing
 * automatically is out of scope this wave, see the epic). `prepared` is
 * always fully assembled first; this function's only job is the auto-send
 * gate itself (#72's acceptance: "nothing sends without an explicit
 * action while auto-send is off"). The `manual` trigger's compose screen
 * never calls this — a human looking at the preview and clicking "Send"
 * is already the explicit action, regardless of this flag.
 */
export async function composeForAutomaticTrigger(
	prepared: PreparedSend,
	autoSendMail: boolean,
	mailConfig: MailConfig,
	executor: DbExecutor = db
): Promise<AutomaticSendResult> {
	if (!autoSendMail) return { sent: false };
	const result = await dispatchEmail(prepared, mailConfig, true, executor);
	return { sent: true, ...result };
}
