-- Records that must never be rewritten are append-only in the database (SEC-14, SEC-22).
--
-- The ledger, the clearing event log, withdrawals, the admin audit trail, the
-- settings change trail and the dispute thread are evidence. The application
-- never updates or deletes a row in them, so the database refuses to as well:
-- a compromised service credential, a repair script or a stray query cannot
-- quietly rewrite history. Applies to every role, the table owner included.
--
-- Row-level triggers do not fire on TRUNCATE, so test suites and `db-wipe` still
-- clear these tables; that is a deliberate, separate act.
CREATE FUNCTION forbid_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER clearing_events_append_only BEFORE UPDATE OR DELETE ON clearing_events
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER wallet_withdrawals_append_only BEFORE UPDATE OR DELETE ON wallet_withdrawals
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER admin_audit_events_append_only BEFORE UPDATE OR DELETE ON admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER merchant_setting_changes_append_only BEFORE UPDATE OR DELETE ON merchant_setting_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
--> statement-breakpoint
CREATE TRIGGER escrow_dispute_messages_append_only BEFORE UPDATE OR DELETE ON escrow_dispute_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();
