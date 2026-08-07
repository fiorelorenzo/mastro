import type { RegisterEntryApproval } from './types';

/**
 * The literal text that appears in the "approval" cell of both the PDF and
 * the CSV, so the two are guaranteed to carry the same figure rather than
 * two renderers independently agreeing on wording — see
 * `equivalence.test.ts`.
 *
 * Deliberately not run through the translation layer, and not phrased as a
 * sentence: `channel` is the enum value verbatim, the same way the clients
 * screen shows `client.country` as a raw ISO code rather than a localised
 * country name. This is a contractual, potentially disputed figure — the
 * client is entitled to cross-check it against their own mailbox — so it
 * stays unambiguous and locale-invariant. The register's date and quantity
 * cells (`pdf.ts`, `csv.ts`) follow the same rule for the same reason:
 * ISO dates and plain decimals rather than `formatDate`/`Intl.NumberFormat`,
 * because a locale-formatted decimal separator or day/month order is
 * exactly the kind of ambiguity a document the client can dispute must not
 * carry.
 */
export function formatApprovalReference(approval: RegisterEntryApproval): string {
	const receivedOn = approval.receivedAt.toISOString().slice(0, 10);
	const parts = [approval.channel, approval.sender, receivedOn];
	if (approval.messageId) parts.push(approval.messageId);
	return parts.join(' · ');
}
