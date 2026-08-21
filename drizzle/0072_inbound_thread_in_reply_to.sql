-- #400: extraction reads a conversation, not a message.
--
-- `In-Reply-To` is what turns archived messages back into the exchange they
-- came from. Without it every message was judged alone, which on the first
-- real mailbox produced three proposals for one day: a reply quoting its
-- parent re-stated the parent's sentence, and no message was read together
-- with the answer it received. The Polymarket half-day is the case that
-- makes it unarguable - the client offers the allocation in one message and
-- the owner accepts in the next, so the approval exists in neither message
-- on its own.
--
-- Nullable, and no backfill. Every row already archived has no value here,
-- and unlike `sender_address` (#394) this one cannot be recovered from the
-- stored bytes for free: it can, the header is in the `.eml`, but a
-- conversation reconstructed after the fact would re-extract messages that
-- already produced proposals a human has since reviewed. The rows that
-- matter are the ones that arrive from here on.

ALTER TABLE "inbound_thread" ADD COLUMN "in_reply_to" text;