-- CLI-created20261021022906; retry only explicitly cashier-confirmed bank rows.
-- Keep auto setting OFF; no public/helper grants or money changes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $migration$
DECLARE body text; definition text; anchor text:='cm.method=''cash''';
 replacement text:=$predicate$(cm.method='cash' OR (cm.method='bank' AND EXISTS(
 SELECT 1 FROM public.payment_settlements manual
 WHERE manual.bank_transaction_id=cm.bank_transaction_id
 AND manual.tournament_registration_id=cm.registration_id
 AND manual.club_id=cm.club_id AND manual.confirmed_by=cm.actor_id
 AND manual.outcome='manual_confirmed')))$predicate$;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc
 WHERE oid=to_regprocedure('public.cashier_retry_paid_seating_v1(boolean,integer)');
 IF body IS NULL OR md5(body)<>'8b4337580510def80331a8cbe2f46f98' THEN RAISE EXCEPTION 'manual_bank227_definition_drift'; END IF;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 THEN RAISE EXCEPTION 'manual_bank227_anchor_drift'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $migration$;
COMMIT;
