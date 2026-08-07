import type { NoticeChannel } from '$lib/server/db/schema';

/**
 * The proof behind one register row, read off the `approval` it names —
 * never a summary of it. `receivedAt` and `messageId` are exactly the
 * columns a client can cross-check against their own mailbox.
 */
export type RegisterEntryApproval = {
	readonly channel: NoticeChannel;
	readonly sender: string;
	readonly receivedAt: Date;
	readonly messageId: string | null;
};

/** One billed day (#70): the ledger fields verbatim, plus the approval
 * that authorised it. */
export type RegisterEntry = {
	readonly workUnitId: string;
	/** ISO date, e.g. `'2024-03-05'`. */
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly approval: RegisterEntryApproval;
};

/** The register for one contract over one period (inclusive ISO dates). */
export type Register = {
	readonly contractId: string;
	readonly from: string;
	readonly to: string;
	readonly entries: readonly RegisterEntry[];
	readonly totalQuantity: number;
};
