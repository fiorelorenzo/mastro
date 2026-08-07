// Assembles a template's configured attachment set fresh from the ledger,
// at send time, every time (#71's acceptance: never a stored blob). Only
// the two kinds `EMAIL_ATTACHMENT_KINDS` currently allows are handled —
// see that constant's doc comment in `db/schema/email-template.ts` for why
// `invoice_pdf` and `expense_receipts` are not here yet.
import { db, type DbExecutor } from '$lib/server/db';
import type { EmailAttachmentKind } from '$lib/server/db/schema';
import { buildRegister } from '$lib/server/repositories/register';
import { renderRegisterCsv } from '$lib/server/register/csv';
import { renderRegisterPdf } from '$lib/server/register/pdf';

export type EmailAttachment = {
	filename: string;
	contentType: string;
	content: Buffer;
};

/** Assembles the attachments `kinds` names for `contractId` over `period`.
 * Builds the register at most once even when both register attachment
 * kinds are requested, so the PDF and the CSV in one send always describe
 * the exact same query result. */
export async function assembleAttachments(
	kinds: readonly EmailAttachmentKind[],
	contractId: string,
	period: { from: string; to: string },
	executor: DbExecutor = db
): Promise<EmailAttachment[]> {
	const needsRegister = kinds.includes('day_register_pdf') || kinds.includes('day_register_csv');
	const register = needsRegister
		? await buildRegister(contractId, period.from, period.to, executor)
		: null;
	const baseName = `day-register-${period.from}-to-${period.to}`;

	const attachments: EmailAttachment[] = [];
	for (const kind of kinds) {
		if (kind === 'day_register_pdf' && register) {
			attachments.push({
				filename: `${baseName}.pdf`,
				contentType: 'application/pdf',
				content: await renderRegisterPdf(register)
			});
		} else if (kind === 'day_register_csv' && register) {
			attachments.push({
				filename: `${baseName}.csv`,
				contentType: 'text/csv',
				content: Buffer.from(renderRegisterCsv(register), 'utf8')
			});
		}
	}
	return attachments;
}
