-- SOURCE only: promote to a NEW reviewed migration before any live use.
-- Roll back the reviewed frontend artifact first. Revoke new read APIs only;
-- preserve all historical data, migration receipts, V1/V3 and all writers.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE expected record; actual record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reads76_77_compensation_owner_required'; END IF;
 FOR expected IN SELECT * FROM (VALUES
 ('floor_private.tracker_hand_input_context_v4(uuid)','588f4bc2f1b8ce3839bb42a635f7b6a0',true,'s'),
 ('public.get_tracker_hand_input_tables_v4(uuid)','b815d03fd7b596eba689f7a788fc49fc',false,'s'),
 ('floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)','1e55b9ed040ac4a384265df912c2edce',true,'v'),
 ('public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)','2d58c68cc297e4df045c30a6c71444c5',false,'v')) f(signature,digest,definer,volatility) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=expected.signature::regprocedure;
  IF md5(replace(pg_get_functiondef(actual.oid),chr(13),'')) IS DISTINCT FROM expected.digest
   OR pg_get_userbyid(actual.proowner)<>'postgres' OR actual.prosecdef IS DISTINCT FROM expected.definer
   OR actual.provolatile::text IS DISTINCT FROM expected.volatility
   OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR actual.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
  THEN RAISE EXCEPTION 'reads76_77_compensation_drift: %',expected.signature; END IF;
 END LOOP;
END;
$guard$;
REVOKE ALL ON FUNCTION floor_private.tracker_hand_input_context_v4(uuid),
 public.get_tracker_hand_input_tables_v4(uuid),
 floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint),
 public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
DO $postcheck$
DECLARE signature text; role_name text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['floor_private.tracker_hand_input_context_v4(uuid)',
 'public.get_tracker_hand_input_tables_v4(uuid)','floor_private.tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)',
 'public.get_tracker_roster_snapshot_v2(uuid,uuid,uuid,bigint)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,signature,'EXECUTE') THEN RAISE EXCEPTION 'reads76_77_compensation_execute_remains'; END IF;
  END LOOP;
 END LOOP;
END;
$postcheck$;
COMMIT;
