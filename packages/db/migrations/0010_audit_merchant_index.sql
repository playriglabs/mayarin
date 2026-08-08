-- The audit trail's entry point (#16) reads one merchant's payments, newest
-- first, inside a time window. `clearing_transactions` had no index leading on
-- `merchant_id`, so that query scanned every payment the deployment ever took
-- and got slower with every payment it took after.
--
-- Written by hand rather than generated: `0009_scaled_rate` was added to the
-- journal without a matching `meta/0009_snapshot.json`, so drizzle-kit cannot
-- diff from the current schema and re-proposes 0009's rename. Regenerating that
-- snapshot is a repo-wide fix, not this change's business.
CREATE INDEX "clearing_transactions_merchant_idx" ON "clearing_transactions" USING btree ("merchant_id","created_at");
