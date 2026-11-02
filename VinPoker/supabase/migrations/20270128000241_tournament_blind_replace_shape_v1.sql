-- CLI generated20261023085723; forward241 reserved after collision checks.
-- Keep invoker/RLS/parent lock and successful legacy response unchanged.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_user='postgres';
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)='dfb99c7cab941b59edca5ade048242e9';
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_blinds240()'::regprocedure)='f6d7d369d7cf04e154750bd676370333';
 ASSERT to_regclass('floor_private.blind_structure_update_backup241') IS NULL;
END $$;
CREATE TABLE floor_private.blind_structure_update_backup241(
 id boolean PRIMARY KEY CHECK(id),before_definition text NOT NULL,before_acl aclitem[],after_body_md5 text);
ALTER TABLE floor_private.blind_structure_update_backup241 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.blind_structure_update_backup241 FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE definition text;acl aclitem[];
 marker text:='    DELETE FROM public.tournament_levels WHERE tournament_id = p_tournament_id;';
 guard text:=E'    IF p_levels IS NULL OR pg_catalog.jsonb_typeof(p_levels) IS DISTINCT FROM ''array'' THEN\n        RAISE EXCEPTION ''blind_structure_empty_or_invalid'' USING ERRCODE=''23514'';\n    END IF;\n    IF pg_catalog.jsonb_array_length(p_levels)=0 THEN\n        RAISE EXCEPTION ''blind_structure_empty_or_invalid'' USING ERRCODE=''23514'';\n    END IF;\n';
BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,acl FROM pg_proc
 WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig IS NULL;
 ASSERT definition IS NOT NULL;
 ASSERT array_length(string_to_array(definition,marker),1)=2;
 INSERT INTO floor_private.blind_structure_update_backup241(id,before_definition,before_acl) VALUES(true,definition,acl);
 EXECUTE replace(definition,marker,guard||marker);
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure) IS NOT DISTINCT FROM acl;
 ASSERT (SELECT NOT prosecdef AND proconfig IS NULL FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure);
 UPDATE floor_private.blind_structure_update_backup241 SET after_body_md5=(
  SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure) WHERE id;
END $$;
COMMIT;
