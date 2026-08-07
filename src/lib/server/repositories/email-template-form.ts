import * as m from '$lib/paraglide/messages';
import {
	EMAIL_ATTACHMENT_KINDS,
	type EmailAttachmentKind,
	type EmailTemplateTrigger
} from '$lib/server/db/schema';
import { findUnknownPlaceholders } from '$lib/server/mail/placeholders';
import type { EmailTemplateInput } from './email-template';

export type EmailTemplateFormValues = {
	contractId: string;
	name: string;
	subject: string;
	body: string;
	attachmentKinds: string[];
	triggerKind: string;
	triggerDays: string;
};

export type EmailTemplateFormResult =
	| { ok: true; input: EmailTemplateInput; values: EmailTemplateFormValues }
	| { ok: false; errors: Record<string, string>; values: EmailTemplateFormValues };

const KNOWN_ATTACHMENT_KINDS: Readonly<Record<string, true>> = Object.fromEntries(
	EMAIL_ATTACHMENT_KINDS.map((kind) => [kind, true])
);

/**
 * Parses and validates an `email_template` create/edit submission (#71).
 * `findUnknownPlaceholders` runs unconditionally, over whatever text was
 * submitted: an unknown `{{...}}` fails the save here, before a row is
 * ever written — the acceptance is "at edit time, not at send time".
 */
export function parseEmailTemplateForm(formData: FormData): EmailTemplateFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const contractId = string('contractId');
	if (!contractId) errors.contractId = m.mail_template_validation_contract_required();

	const name = string('name');
	if (!name) errors.name = m.mail_template_validation_name_required();

	const subject = string('subject');
	if (!subject) errors.subject = m.mail_template_validation_subject_required();

	const body = string('body');
	if (!body) errors.body = m.mail_template_validation_body_required();

	const attachmentKinds = formData
		.getAll('attachmentKinds')
		.map((value) => String(value))
		.filter((value): value is EmailAttachmentKind => KNOWN_ATTACHMENT_KINDS[value] === true);

	const triggerKind = string('triggerKind');
	const triggerDaysRaw = string('triggerDays');
	let trigger: EmailTemplateTrigger | null = null;
	if (triggerKind === 'manual' || triggerKind === 'on_issue') {
		trigger = { kind: triggerKind };
	} else if (triggerKind === 'days_before_due') {
		const days = Number(triggerDaysRaw);
		if (!Number.isInteger(days) || days <= 0) {
			errors.triggerDays = m.mail_template_validation_days_before_due_invalid();
		} else {
			trigger = { kind: 'days_before_due', days };
		}
	} else {
		errors.triggerKind = m.mail_template_validation_trigger_invalid();
	}

	const unknownPlaceholders = findUnknownPlaceholders(subject, body);
	if (unknownPlaceholders.length > 0) {
		errors.placeholders = m.mail_template_validation_unknown_placeholder({
			placeholder: unknownPlaceholders.join(', ')
		});
	}

	const values: EmailTemplateFormValues = {
		contractId,
		name,
		subject,
		body,
		attachmentKinds,
		triggerKind,
		triggerDays: triggerDaysRaw
	};

	if (Object.keys(errors).length > 0 || !trigger) {
		return { ok: false, errors, values };
	}

	return {
		ok: true,
		input: { contractId, name, subject, body, attachmentKinds, trigger },
		values
	};
}
