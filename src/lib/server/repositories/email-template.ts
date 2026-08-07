import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	emailTemplate,
	type EmailAttachmentKind,
	type EmailTemplateTrigger
} from '$lib/server/db/schema';

export type EmailTemplateInput = {
	contractId: string;
	name: string;
	subject: string;
	body: string;
	attachmentKinds: EmailAttachmentKind[];
	trigger: EmailTemplateTrigger;
};

export async function listEmailTemplates() {
	return db.query.emailTemplate.findMany({
		with: { contract: true },
		orderBy: asc(emailTemplate.name)
	});
}

export async function listEmailTemplatesForContract(contractId: string) {
	return db.query.emailTemplate.findMany({
		where: eq(emailTemplate.contractId, contractId),
		orderBy: asc(emailTemplate.name)
	});
}

export async function getEmailTemplate(id: string) {
	return db.query.emailTemplate.findFirst({
		where: eq(emailTemplate.id, id),
		with: { contract: true }
	});
}

export async function createEmailTemplate(input: EmailTemplateInput) {
	const [row] = await db.insert(emailTemplate).values(input).returning();
	return row;
}

export async function updateEmailTemplate(id: string, input: EmailTemplateInput) {
	const [row] = await db
		.update(emailTemplate)
		.set(input)
		.where(eq(emailTemplate.id, id))
		.returning();
	return row;
}
