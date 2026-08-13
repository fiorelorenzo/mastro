// Parses a dunning send screen's submission (#73): which of the contract's
// `days_after_due`-triggered templates to use, and who to send it to. The
// invoice itself is never typed in — it is the real, persisted row the
// screen loaded (`routes/invoices/[id]/remind`), the same "pick the real
// row, never retype its figures" rule the general compose screen's own
// invoice picker follows since #218 (`mail-send-form.ts`).
import * as m from '$lib/paraglide/messages';
import type { EmailAttachmentKind, EmailTemplateTrigger } from '$lib/server/db/schema';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The handful of fields `prepareEmail` reads off a template row, plus
 * `name` for the picker on the compose screen — enough to accept exactly
 * what `listEmailTemplatesForContract` returns, without this module
 * depending on that query's own return type. */
export type DunningTemplateOption = {
	id: string;
	contractId: string;
	name: string;
	subject: string;
	body: string;
	attachmentKinds: EmailAttachmentKind[];
	trigger: EmailTemplateTrigger;
};

export type DunningSendFormValues = { templateId: string; to: string };

export type DunningSendFormResult =
	| { ok: true; template: DunningTemplateOption; to: string[]; values: DunningSendFormValues }
	| { ok: false; errors: Record<string, string>; values: DunningSendFormValues };

/**
 * Validates `templateId` against `templates` — the contract's own
 * `days_after_due`-triggered templates, so a submission cannot name a
 * template belonging to another contract or one with the wrong trigger —
 * and `to` the same way the general compose screen does.
 */
export function parseDunningSendForm(
	formData: FormData,
	templates: readonly DunningTemplateOption[]
): DunningSendFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const templateId = string('templateId');
	const template = templates.find((candidate) => candidate.id === templateId);
	if (!template) errors.templateId = m.mail_dunning_validation_template_required();

	const toRaw = string('to');
	const to = toRaw
		.split(/[,\n]/)
		.map((address) => address.trim())
		.filter((address) => address.length > 0);
	if (to.length === 0) {
		errors.to = m.mail_send_validation_to_required();
	} else {
		const invalid = to.find((address) => !EMAIL_PATTERN.test(address));
		if (invalid) errors.to = m.mail_send_validation_to_invalid({ email: invalid });
	}

	const values: DunningSendFormValues = { templateId, to: toRaw };

	if (Object.keys(errors).length > 0 || !template) return { ok: false, errors, values };

	return { ok: true, template, to, values };
}
