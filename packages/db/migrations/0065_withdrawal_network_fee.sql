-- A withdrawal pays its own gas: the network fee is taken out of the amount, in
-- the asset withdrawn, and the destination receives the amount less the fee.
-- Earlier rows paid none, which is what the default says.
-- Written by hand like every migration since 0009.
ALTER TABLE "wallet_withdrawals"
  ADD COLUMN "network_fee" numeric(78, 0) NOT NULL DEFAULT 0;
