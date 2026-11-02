-- CLI generated20261023102226; forward243 reserved after source/local catalog checks.
-- Use existing get_tournament_clock elapsed conversion for adjustment baseline.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_user='postgres';
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure)='b2cc545b44f169740cd9476e9fb78259';
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tournament_clock(uuid)'::regprocedure)='3ed1ff57d2c6379bb7325958b29ff416';
 ASSERT to_regclass('floor_private.clock_control_backup243') IS NULL;
END $$;
CREATE TABLE floor_private.clock_control_backup243(id boolean PRIMARY KEY CHECK(id),before_definition text NOT NULL,before_acl aclitem[],after_body_md5 text);
ALTER TABLE floor_private.clock_control_backup243 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.clock_control_backup243 FROM PUBLIC,anon,authenticated,service_role;
DO $migration$ DECLARE definition text;acl aclitem[];
 marker text:=E'v_elapsed_seconds := FLOOR(EXTRACT(EPOCH FROM (\n        v_reference_time - v_tour.clock_started_at\n      )))::INTEGER';
 replacement text:=E'v_elapsed_seconds := EXTRACT(EPOCH FROM (\n        v_reference_time - v_tour.clock_started_at\n      ))::INTEGER';
BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,acl FROM pg_proc
 WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure
   AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public'];
 ASSERT definition IS NOT NULL AND array_length(string_to_array(definition,marker),1)=2;
 INSERT INTO floor_private.clock_control_backup243(id,before_definition,before_acl) VALUES(true,definition,acl);
 EXECUTE replace(definition,marker,replacement);
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure) IS NOT DISTINCT FROM acl;
 UPDATE floor_private.clock_control_backup243 SET after_body_md5=(SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure) WHERE id;
END $migration$;
COMMIT;
