-- Compensation SOURCE only; promote to a NEW reviewed migration for live.
-- Restore the previous reviewed frontend/Edge artifacts before exposing users
-- to revoked routes. This disables only75, not legacy/shared card writers.
-- Keep all cards, source revisions, receipts, ledger and audit history intact.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE expected record; actual record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'manual75_compensation_owner_required'; END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)','37faf2e637e06d255c0f9186d3a7e9e9',true,'v'),
  ('public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)','0e43636469573f0f9722639ca283f346',false,'v'),
  ('floor_private.tracker_manual_card_receipt_v1(text,jsonb)','47b08ebea2d7909ae8e8d99864440560',true,'s'),
  ('public.get_tracker_manual_card_receipt_v1(text,jsonb)','29f9eeb5563d236d0c6de4cf8c0f98b9',false,'s')
 ) AS definitions(signature,digest,definer,volatility) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=expected.signature::regprocedure;
  IF md5(replace(pg_get_functiondef(actual.oid),chr(13),'')) IS DISTINCT FROM expected.digest
   OR pg_get_userbyid(actual.proowner) IS DISTINCT FROM 'postgres'
   OR actual.prosecdef IS DISTINCT FROM expected.definer
   OR actual.provolatile::text IS DISTINCT FROM expected.volatility
   OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR actual.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  THEN RAISE EXCEPTION 'manual75_compensation_definition_or_acl_drift: %',expected.signature; END IF;
 END LOOP;
END;
$guard$;
REVOKE ALL ON FUNCTION public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb),
 floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb),
 public.get_tracker_manual_card_receipt_v1(text,jsonb),
 floor_private.tracker_manual_card_receipt_v1(text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
DO $postcheck$
DECLARE signature text; role_name text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.show_tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)',
  'floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)',
  'public.get_tracker_manual_card_receipt_v1(text,jsonb)',
  'floor_private.tracker_manual_card_receipt_v1(text,jsonb)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,signature,'EXECUTE') THEN
    RAISE EXCEPTION 'manual75_compensation_execute_privilege_remains: %, %',role_name,signature;
   END IF;
  END LOOP;
 END LOOP;
END;
$postcheck$;
COMMIT;
