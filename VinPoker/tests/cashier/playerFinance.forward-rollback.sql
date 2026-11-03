-- Recovery plan, execute only as a separately approved versioned migration.
-- Restore the previously verified frontend revision and revoke additive reads.
-- No receipts, prices, results, history or user records are deleted/rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
REVOKE ALL ON FUNCTION public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_public_player_paid_winnings_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
