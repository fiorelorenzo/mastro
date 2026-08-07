import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { approval, workUnit } from '$lib/server/db/schema';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';
import type { Register, RegisterEntry } from '$lib/server/register/types';

/**
 * A day counts as "billed" once it has passed through `invoiced` —
 * including one currently `disputed` (it was invoiced, then disputed; the
 * register still names the approval that authorised it) and one already
 * `paid`. The state machine trigger (`drizzle/0012_work_unit_state_machine.sql`)
 * has no edge into any of these three except by way of `invoiced` first, so
 * this set is exactly "ever billed", not an approximation of it.
 */
const BILLED_STATES: readonly WorkUnitState[] = ['invoiced', 'disputed', 'paid'];

/**
 * The register for `contractId` over `[from, to]` (inclusive ISO dates):
 * every billed day with the approval that authorised it, oldest first, and
 * the total quantity (#70).
 *
 * Joins `approval` with an INNER JOIN, not a LEFT JOIN, on purpose. A
 * billed day with no `approval_id` is possible — only on a contract with
 * `requires_prior_approval = false`, since the state machine trigger only
 * enforces the approval requirement when that flag is set — but this
 * artifact's whole contractual promise is "every row carries its approval
 * reference" (#70's acceptance). A row with nothing to reference does not
 * belong in it, so such a day is silently excluded here rather than
 * emitted with a blank reference; `register.test.ts` covers this case
 * explicitly so the exclusion is a tested decision, not an oversight.
 */
export async function buildRegister(
	contractId: string,
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<Register> {
	const rows = await executor
		.select({
			workUnitId: workUnit.id,
			date: workUnit.date,
			quantity: workUnit.quantity,
			scope: workUnit.scope,
			approvalChannel: approval.channel,
			approvalSender: approval.sender,
			approvalReceivedAt: approval.receivedAt,
			approvalMessageId: approval.messageId
		})
		.from(workUnit)
		.innerJoin(approval, eq(workUnit.approvalId, approval.id))
		.where(
			and(
				eq(workUnit.contractId, contractId),
				gte(workUnit.date, from),
				lte(workUnit.date, to),
				inArray(workUnit.state, BILLED_STATES)
			)
		)
		.orderBy(asc(workUnit.date));

	const entries: RegisterEntry[] = rows.map((row) => ({
		workUnitId: row.workUnitId,
		date: row.date,
		quantity: row.quantity,
		scope: row.scope,
		approval: {
			channel: row.approvalChannel,
			sender: row.approvalSender,
			receivedAt: row.approvalReceivedAt,
			messageId: row.approvalMessageId
		}
	}));

	const totalQuantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);

	return { contractId, from, to, entries, totalQuantity };
}
