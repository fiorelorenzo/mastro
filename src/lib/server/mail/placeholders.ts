// Placeholder handling for `email_template` (#71). Substitution and
// validation share one token pattern so they can never disagree on what
// counts as a placeholder.
import { EMAIL_TEMPLATE_PLACEHOLDERS, type EmailTemplatePlaceholder } from '$lib/server/db/schema';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Every `{{...}}` token in `subject`/`body` that does not name a known
 * placeholder (`EMAIL_TEMPLATE_PLACEHOLDERS`); empty when the template is
 * safe to save. This is the check that must run before a template is
 * written — #71's acceptance is that an unknown placeholder fails at edit
 * time, not at send time — see
 * `src/lib/server/repositories/email-template-form.ts`.
 */
export function findUnknownPlaceholders(subject: string, body: string): string[] {
	const known: Readonly<Record<string, true>> = Object.fromEntries(
		EMAIL_TEMPLATE_PLACEHOLDERS.map((placeholder) => [placeholder, true])
	);
	const tokens = [
		...subject.matchAll(PLACEHOLDER_PATTERN),
		...body.matchAll(PLACEHOLDER_PATTERN)
	].map((match) => match[1]);
	return [...new Set(tokens.filter((token) => !known[token]))];
}

/**
 * Replaces every `{{...}}` token in `text` with its value from `values`.
 * Every key `findUnknownPlaceholders` allows through is required here —
 * a `values` object missing one throws rather than leaving the raw token
 * in the rendered output, since a template that passed validation is
 * supposed to make that impossible; a thrown error here means the
 * validation and the renderer have drifted apart, which is a defect to
 * surface loudly, not a token to leave visible to a client.
 */
export function substitutePlaceholders(
	text: string,
	values: Readonly<Record<EmailTemplatePlaceholder, string>>
): string {
	return text.replace(PLACEHOLDER_PATTERN, (raw, name: string) => {
		if (!(name in values)) {
			throw new Error(
				`no value supplied for placeholder {{${name}}}; was it validated at save time?`
			);
		}
		return values[name as EmailTemplatePlaceholder];
	});
}
