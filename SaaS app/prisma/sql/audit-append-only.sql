-- Makes the audit trails append-only at the database level: any UPDATE, DELETE or TRUNCATE on
-- "AuditLog" or "BillingHistory" raises an error, whoever runs it (the app, a script, a person in psql).
-- Idempotent: safe to run on every deploy (npm run db:harden). Statements are separated by "-- @@".
--
-- Limits (see docs/hipaa-readiness.md): a role that OWNS the tables can still disable the triggers or drop
-- the tables. Run the app with a role that has only SELECT and INSERT on these two tables, and keep the owner
-- role for migrations only.

CREATE OR REPLACE FUNCTION phi_reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on table "%" is not allowed: it is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
-- @@
DROP TRIGGER IF EXISTS "AuditLog_append_only" ON "AuditLog";
-- @@
CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION phi_reject_modification();
-- @@
DROP TRIGGER IF EXISTS "AuditLog_no_truncate" ON "AuditLog";
-- @@
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION phi_reject_modification();
-- @@
DROP TRIGGER IF EXISTS "BillingHistory_append_only" ON "BillingHistory";
-- @@
CREATE TRIGGER "BillingHistory_append_only"
  BEFORE UPDATE OR DELETE ON "BillingHistory"
  FOR EACH ROW EXECUTE FUNCTION phi_reject_modification();
-- @@
DROP TRIGGER IF EXISTS "BillingHistory_no_truncate" ON "BillingHistory";
-- @@
CREATE TRIGGER "BillingHistory_no_truncate"
  BEFORE TRUNCATE ON "BillingHistory"
  FOR EACH STATEMENT EXECUTE FUNCTION phi_reject_modification();
