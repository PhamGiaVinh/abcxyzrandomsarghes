-- CLI scaffold20261021065906, forward234 reserved after source/native catalog check.
-- Validate new single-day/schedule creates without rewriting old receipts or history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure)
   IS DISTINCT FROM '341383f50c5c5aa61ca552a0cbcc5d08'
 OR to_regclass('floor_private.tournament_create_release_backup234') IS NOT NULL THEN
  RAISE EXCEPTION 'create234_precondition_drift'; END IF;
END $$;
CREATE TABLE floor_private.tournament_create_release_backup234(
 id boolean PRIMARY KEY CHECK(id),saved_definition text NOT NULL,old_md5 text NOT NULL,
 owner_name text NOT NULL,saved_acl aclitem[]
);
ALTER TABLE floor_private.tournament_create_release_backup234 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tournament_create_release_backup234 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.tournament_create_release_backup234
 SELECT true,pg_get_functiondef(oid),md5(prosrc),pg_get_userbyid(proowner),proacl FROM pg_proc
 WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
DO $patch$ DECLARE definition text; anchor text:='  INSERT INTO public.tournaments('; BEGIN
 SELECT saved_definition INTO STRICT definition FROM floor_private.tournament_create_release_backup234 WHERE id;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'create234_anchor_missing'; END IF;
 -- Guard only new rows, after the existing exact-payload receipt replay branch.
 definition:=replace(definition,anchor,$guard$
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_config) AS field(key,value)
    WHERE field.key IN('buy_in','rake_amount','service_fee_amount','guarantee_amount')
      AND field.value<>'null'::jsonb AND
      CASE WHEN pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'number' THEN true
      ELSE (field.value::text)::numeric<0 OR (field.value::text)::numeric>9007199254740991
        OR (field.value::text)::numeric<>pg_catalog.trunc((field.value::text)::numeric) END)
  THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_money'); END IF;
  INSERT INTO public.tournaments($guard$);
 EXECUTE definition;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN floor_private.tournament_create_release_backup234 b
  WHERE p.oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
  AND (p.proacl IS DISTINCT FROM b.saved_acl OR pg_get_userbyid(p.proowner) IS DISTINCT FROM b.owner_name)) THEN
  RAISE EXCEPTION 'create234_acl_owner_changed'; END IF;
END $patch$;
COMMIT;
