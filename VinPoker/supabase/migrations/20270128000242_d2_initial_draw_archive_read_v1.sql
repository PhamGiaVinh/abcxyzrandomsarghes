-- CLI generated 20261023094742; forward242 reserved after source/local catalog check.
-- Add immutable initial seating projection outside the existing sourceHash inputs.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_user='postgres';
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure)='ef51ea7658d54f31cea9679260992afa';
 ASSERT to_regclass('floor_private.d2_roster_backup242') IS NULL;
END $$;
CREATE TABLE floor_private.d2_roster_backup242(
 id boolean PRIMARY KEY CHECK(id),before_definition text NOT NULL,before_acl aclitem[],after_body_md5 text);
ALTER TABLE floor_private.d2_roster_backup242 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.d2_roster_backup242 FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE definition text; acl aclitem[];
 marker text:='''players'',players,''tables'',tables);';
 replacement text:=$projection$'players',players,'tables',tables,
   'initialDraws',(SELECT coalesce(jsonb_agg(jsonb_build_object(
     'planId',p.id,'eventId',p.event_id,'finalTournamentId',p.final_tournament_id,
     'appliedAt',a.applied_at,'assignments',(
       SELECT jsonb_agg(x.value-'requestId' ORDER BY x.ordinality)
       FROM jsonb_array_elements(a.receipt->'assignments') WITH ORDINALITY x(value,ordinality)
     )) ORDER BY a.applied_at,p.id),'[]'::jsonb)
     FROM private.multi_day_initial_draw_plans_v1 p
     JOIN private.multi_day_initial_draw_applications_v1 a ON a.plan_id=p.id
     WHERE p.event_id=p_event_id AND p.final_tournament_id=final.id
       AND a.receipt->>'eventId'=p.event_id::text
       AND a.receipt->>'finalTournamentId'=p.final_tournament_id::text
       AND a.receipt->>'planId'=p.id::text
       AND a.receipt->>'state'='APPLIED' AND a.receipt->'ok'='true'::jsonb));$projection$;
BEGIN
 SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,acl FROM pg_proc
 WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure
   AND proowner='postgres'::regrole AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""'];
 ASSERT definition IS NOT NULL;
 ASSERT array_length(string_to_array(definition,marker),1)=2;
 INSERT INTO floor_private.d2_roster_backup242(id,before_definition,before_acl) VALUES(true,definition,acl);
 EXECUTE replace(definition,marker,replacement);
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure) IS NOT DISTINCT FROM acl;
 UPDATE floor_private.d2_roster_backup242 SET after_body_md5=(
  SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure) WHERE id;
END $migration$;
COMMIT;
