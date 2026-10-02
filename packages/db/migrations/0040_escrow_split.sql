-- EscrowFactoryV2 (#315): an arbiter may split a disputed escrow, so a
-- dispute — like the escrow it follows — can end `split`.
--
-- Written by hand like every migration since 0009.
ALTER TABLE "escrow_disputes" DROP CONSTRAINT "escrow_disputes_status_check";
--> statement-breakpoint
ALTER TABLE "escrow_disputes" ADD CONSTRAINT "escrow_disputes_status_check"
	CHECK ("status" IN ('open', 'released', 'refunded', 'split'));
