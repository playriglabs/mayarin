-- Over-refund is refused by the database, not only by the service (SEC-02).
--
-- The service checks the remaining balance under a per-payment advisory lock.
-- That is correct while every writer goes through the service; a second code
-- path, a repair script or a replayed insert would not take the lock. This
-- trigger holds the payment's row while it counts, so two concurrent inserts
-- serialise here too and the second one sees the first.
--
-- FAILED refunds do not count, matching `summariseRefunds`: a refund that did
-- not happen has not used the balance.
CREATE FUNCTION refunds_enforce_balance() RETURNS trigger AS $$
DECLARE
  settled numeric;
  taken numeric;
BEGIN
  IF NEW.state = 'FAILED' THEN
    RETURN NEW;
  END IF;

  SELECT net_amount INTO settled
    FROM clearing_transactions
    WHERE id = NEW.clearing_transaction_id
    FOR NO KEY UPDATE;

  IF settled IS NULL THEN
    RAISE EXCEPTION 'payment % has no settled amount to refund against', NEW.clearing_transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO taken
    FROM refunds
    WHERE clearing_transaction_id = NEW.clearing_transaction_id
      AND state <> 'FAILED'
      AND id <> NEW.id;

  IF taken + NEW.amount > settled THEN
    RAISE EXCEPTION 'refunds on payment % would exceed the settled amount', NEW.clearing_transaction_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER refunds_enforce_balance
  BEFORE INSERT OR UPDATE OF amount, state ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_enforce_balance();
