import * as m from '$lib/paraglide/messages';
import type { ApprovalInput } from './approval';

export type ApprovalFormValues = {
	channel: string;
	sender: string;
	receivedAt: string;
	excerpt: string;
	confidential: boolean;
	proofText: string;
};

/**
 * The half of `ApprovalInput` this form actually builds:
 * `contractId` comes from the route (the contract the form is scoped to,
 * never a field a submission can override), `messageId` stays null (a
 * human typing this in was never handed a Message-ID header, even when
 * `channel` is `email` — a forwarded copy or a screenshot has no such
 * thing), and `document` is built by the caller once the parse below has
 * decided which proof was supplied, since reading a `File`'s bytes is
 * async and this function is not.
 */
export type ParsedApprovalInput = Omit<ApprovalInput, 'contractId' | 'messageId' | 'document'> & {
	/** Which proof field to build the archived document from — `parseApprovalForm`
	 * has already confirmed exactly one of `proofFile`/`proofText` was supplied. */
	proof: 'file' | 'text';
};

export type ApprovalFormResult =
	| { ok: true; input: ParsedApprovalInput; values: ApprovalFormValues }
	| { ok: false; errors: Record<string, string>; values: ApprovalFormValues };

/**
 * Parses and validates a manual approval submission (#210) — the human
 * path alongside the IMAP pipeline's `createApproval`. `validChannels`
 * comes from `noticeChannel.enumValues` (`db/schema/client.ts`), read by
 * the caller server-side: the set of legal values lives in exactly one
 * place, the schema, not duplicated here as a second literal list.
 *
 * The proof is exactly one of an uploaded file or pasted text — never
 * both, never neither — mirroring `approval_excerpt_not_blank` and the
 * rest of `0011_approval_constraints.sql`'s discipline of catching a shape
 * mistake here rather than letting it round-trip to the database only to
 * bounce back as a 500.
 */
export function parseApprovalForm(
	formData: FormData,
	validChannels: readonly string[]
): ApprovalFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const channel = string('channel');
	if (!channel) {
		errors.channel = m.approval_form_validation_channel_required();
	} else if (!validChannels.includes(channel)) {
		errors.channel = m.approval_form_validation_channel_invalid();
	}

	const sender = string('sender');
	if (!sender) errors.sender = m.approval_form_validation_sender_required();

	const receivedAtRaw = string('receivedAt');
	const receivedAtDate = receivedAtRaw ? new Date(receivedAtRaw) : null;
	if (!receivedAtRaw || !receivedAtDate || Number.isNaN(receivedAtDate.getTime())) {
		errors.receivedAt = m.approval_form_validation_received_at_required();
	}

	const excerpt = string('excerpt');
	if (!excerpt) errors.excerpt = m.approval_form_validation_excerpt_required();

	const confidential = formData.get('confidential') === 'on';

	const proofFile = formData.get('proofFile');
	const hasFile = proofFile instanceof File && proofFile.size > 0;
	const proofText = string('proofText');
	const hasText = proofText.length > 0;
	if (hasFile && hasText) {
		errors.proof = m.approval_form_validation_proof_single();
	} else if (!hasFile && !hasText) {
		errors.proof = m.approval_form_validation_proof_required();
	}

	const values: ApprovalFormValues = {
		channel,
		sender,
		receivedAt: receivedAtRaw,
		excerpt,
		confidential,
		proofText
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			channel: channel as ApprovalInput['channel'],
			sender,
			receivedAt: receivedAtDate!,
			excerpt,
			origin: { kind: 'manual' },
			proof: hasFile ? 'file' : 'text'
		}
	};
}
