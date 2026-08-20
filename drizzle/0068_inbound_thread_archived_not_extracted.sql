-- #380: a third shape for an inbound thread — archived, but deliberately not
-- handed to extraction.
--
-- Until now the shape was binary: archived meant "bytes kept, no skip
-- reason", and skipped meant "no bytes, skip reason given". Watching a whole
-- mailbox introduces a case neither covers. Every message is archived,
-- because a mailbox pass cannot know in advance which one will matter, but
-- extraction costs a model call per message, so only a message whose sender
-- matches a known client contact is handed off. The rest are archived with
-- `sender_unknown` and never enter the extraction queue.
--
-- This makes the constraint more precise rather than looser. It now says
-- exactly which skip reasons keep their bytes and which do not:
--   * 'oversized'      — bytes never fetched (#306), so no document.
--   * 'sender_unknown' — bytes fetched and kept, so a document is required.
-- A row claiming to be archived with no document, or oversized with one, is
-- still impossible.
ALTER TABLE "inbound_thread" DROP CONSTRAINT "inbound_thread_archived_shape";
ALTER TABLE "inbound_thread" DROP CONSTRAINT "inbound_thread_skip_reason_known";

-- Shape only. Which reasons exist is the next constraint's job, so a reason
-- outside the known set is still reported as an unknown reason rather than as
-- a malformed row - the distinction a reader of the error depends on.
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_archived_shape" CHECK (
	-- archived: the bytes are kept. Queued for extraction unless the sender
	-- is unknown, which is a decision about cost, not about the bytes.
	(
		"archived" = true
		AND "document_id" IS NOT NULL
		AND "message_size" IS NULL
		AND ("skip_reason" IS NULL OR "skip_reason" = 'sender_unknown')
	)
	-- never archived: the bytes were refused before they were fetched, so
	-- there is a reason and a reported size, and no document.
	OR (
		"archived" = false
		AND "document_id" IS NULL
		AND "skip_reason" IS NOT NULL
		AND "message_size" IS NOT NULL
	)
);

ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_skip_reason_known" CHECK (
	"skip_reason" IS NULL OR "skip_reason" IN ('oversized', 'sender_unknown')
);
