\set ON_ERROR_STOP on
\if :{?malformed_roster_alias_case}
\else
\set malformed_roster_alias_case false
\endif
-- Optional control distinguishes tuple repair from the missing upstream chip
-- projection. Default remains the original RED; never seed counts silently.
\if :{?seed_chip_projection}
\else
\set seed_chip_projection false
\endif
\if :{?projection_stack}
\else
\set projection_stack 20000
\endif
\if :{?free_sit_roundtrip}
\else
\set free_sit_roundtrip false
\endif
\if :{?manual_entry}
\else
\set manual_entry false
\endif
\if :{?table_mode}
\else
\set table_mode manual
\endif
\if :{?locked_seat_case}
\else
\set locked_seat_case false
\endif
-- Isolated current-schema DB only. All fixture and public writes roll back.
BEGIN;
INSERT INTO auth.users(id) VALUES('f7350000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7350000-0000-4000-8000-000000000002','f7350000-0000-4000-8000-000000000001','Assign participation TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000002','Assign participation TEST','live','playing',1);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7350000-0000-4000-8000-000000000011','f7350000-0000-4000-8000-000000000002','Assign TEST',73,'tournament','inactive','available');
INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,reference_code,status) VALUES
 ('f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000001','f7350000-0000-4000-8000-000000000002',0,'ASSIGN-PARTICIPATION-'||gen_random_uuid()::text,'confirmed');
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,current_stack,status,source) VALUES
 ('f7350000-0000-4000-8000-000000000031','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000001',1,20000,'registered','online');
\if :manual_entry
-- Only isolated preparation: no fabricated registration link for manual entry.
UPDATE public.tournament_entries SET registration_id=NULL, source='manual'
WHERE id='f7350000-0000-4000-8000-000000000031';
\endif
SELECT set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000001',true);
SELECT set_config('test.assign_free_sit_roundtrip', :'free_sit_roundtrip', true);
SELECT set_config('test.assign_manual_entry', :'manual_entry', true);
SELECT set_config('test.assign_table_mode', :'table_mode', true);
SELECT set_config('test.assign_locked_seat', :'locked_seat_case', true);
SELECT set_config('test.assign_malformed_roster_alias', :'malformed_roster_alias_case', true);
SELECT set_config('test.assign_projection_mismatch', (:seed_chip_projection AND :projection_stack <> 20000)::text, true);
\if :seed_chip_projection
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
VALUES('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000001',1,:projection_stack);
\endif
DO $$ DECLARE opened jsonb; result jsonb; projection jsonb; tt uuid; session_id uuid; rev bigint; epoch bigint; active_hand_id uuid; request_id uuid:=gen_random_uuid(); free_request_id uuid:=gen_random_uuid(); replay jsonb; BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000011',current_setting('test.assign_table_mode'),gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'open failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;
 session_id:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
 -- Isolated preparation for stale-session denial; never repair live rows here.
 UPDATE public.table_sessions SET closed_at=pg_catalog.now() WHERE id=session_id;
 PERFORM set_config('role','authenticated',true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,gen_random_uuid());
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'table_session_not_active' THEN
   RAISE EXCEPTION 'closed session must reject assign: %',replay;
 END IF;
 PERFORM set_config('role','none',true);
 UPDATE public.table_sessions SET closed_at=NULL WHERE id=session_id;
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break)
   VALUES('f7350000-0000-4000-8000-000000000003',1,100,200,0,false);
 -- Hand-blind trigger requires a prepared two-seat roster in this isolated fixture.
 INSERT INTO public.tournament_seats(id,tournament_id,table_id,tournament_table_id,table_session_id,seat_number,player_name,chip_count) VALUES
   ('f7350000-0000-4000-8000-000000000061','f7350000-0000-4000-8000-000000000003',tt,tt,session_id,7,'Hand blocker A TEST',20000),
   ('f7350000-0000-4000-8000-000000000062','f7350000-0000-4000-8000-000000000003',tt,tt,session_id,8,'Hand blocker B TEST',20000);
 INSERT INTO public.tournament_hands(tournament_id,table_id,table_session_id,hand_number,status,button_seat)
   VALUES('f7350000-0000-4000-8000-000000000003',tt,session_id,1,'in_progress',7) RETURNING id INTO active_hand_id;
 PERFORM set_config('role','authenticated',true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,gen_random_uuid());
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'table_has_active_hand' THEN
   RAISE EXCEPTION 'active hand must reject assign: %',replay;
 END IF;
 PERFORM set_config('role','none',true);
 UPDATE public.tournament_hands SET status='completed' WHERE id=active_hand_id;
 DELETE FROM public.tournament_seats WHERE id IN
   ('f7350000-0000-4000-8000-000000000061','f7350000-0000-4000-8000-000000000062');
 INSERT INTO auth.users(id) VALUES('f7350000-0000-4000-8000-000000000099');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES
   ('f7350000-0000-4000-8000-000000000098','f7350000-0000-4000-8000-000000000099','Other club TEST','TEST');
 PERFORM set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000099',true);
 PERFORM set_config('role','authenticated',true);
 IF EXISTS(SELECT 1 FROM public.get_floor_seatable_entries('f7350000-0000-4000-8000-000000000003')) THEN
   RAISE EXCEPTION 'other club owner must not read waiting entries';
 END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,gen_random_uuid());
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN
   RAISE EXCEPTION 'other club owner must not assign: %',replay;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','authenticated',true);
 IF current_setting('test.assign_locked_seat')::boolean THEN
   replay:=public.floor_set_table_seat_lock_v1(tt,1,true,'manual assign lock TEST',rev,gen_random_uuid());
   IF replay->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lock fixture failed: %',replay; END IF;
   rev:=(replay->>'revision')::bigint;
   replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,gen_random_uuid());
   IF replay->>'error' IS DISTINCT FROM 'seat_locked' THEN RAISE EXCEPTION 'locked seat assign must deny: %',replay; END IF;
   PERFORM set_config('role','none',true);
   IF EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id='f7350000-0000-4000-8000-000000000031')
     OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev THEN
     RAISE EXCEPTION 'locked seat denial changed canonical state';
   END IF;
   PERFORM set_config('role','authenticated',true);
   replay:=public.floor_set_table_seat_lock_v1(tt,1,false,'manual assign unlock TEST',rev,gen_random_uuid());
   IF replay->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'unlock fixture failed: %',replay; END IF;
   rev:=(replay->>'revision')::bigint;
 END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev-1,gen_random_uuid());
 IF replay->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'stale assign revision must be denied: %',replay; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,10,rev,gen_random_uuid());
 IF replay->>'error' IS DISTINCT FROM 'invalid_seat_number' THEN RAISE EXCEPTION 'outside seat capacity must be denied: %',replay; END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id='f7350000-0000-4000-8000-000000000031')
   OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev THEN
   RAISE EXCEPTION 'rejected stale/capacity intent mutated occupancy or revision';
 END IF;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF current_setting('test.assign_projection_mismatch')::boolean THEN
   IF result->>'ok' IS DISTINCT FROM 'false' OR result->>'error' IS DISTINCT FROM 'chip_projection_mismatch' THEN
     RAISE EXCEPTION 'mismatched projection must deny assign: %',result;
   END IF;
   PERFORM set_config('role','none',true);
   IF EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id='f7350000-0000-4000-8000-000000000031')
     OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev
     OR (SELECT status FROM public.tournament_entries WHERE id='f7350000-0000-4000-8000-000000000031') IS DISTINCT FROM 'registered'
     OR (SELECT chip_count FROM public.tournament_chip_counts WHERE tournament_id='f7350000-0000-4000-8000-000000000003') IS DISTINCT FROM 20001 THEN
     RAISE EXCEPTION 'denied assign mutated canonical state';
   END IF;
   RETURN;
 END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'initial assign failed: %',result; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'same payload must replay original receipt'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,2,rev,request_id);
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
   RAISE EXCEPTION 'changed seat must conflict instead of replay: %',replay;
 END IF;
 replay:=public.floor_assign_entry_to_seat_v4(gen_random_uuid(),tt,1,rev,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed entry must conflict'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',gen_random_uuid(),1,rev,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed table must conflict'; END IF;
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev+1,request_id);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed revision must conflict'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,1,rev,request_id);
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN
   RAISE EXCEPTION 'another actor cannot replay owner receipt: %',replay;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,current_stack,status,source)
 VALUES('f7350000-0000-4000-8000-000000000032','f7350000-0000-4000-8000-000000000003','f7350000-0000-4000-8000-000000000021','f7350000-0000-4000-8000-000000000001',2,20000,'registered','online');
 SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
 PERFORM set_config('role','authenticated',true);
 replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000032',tt,1,rev,gen_random_uuid());
 IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'seat_occupied' THEN
   RAISE EXCEPTION 'occupied seat must deny assignment: %',replay;
 END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id='f7350000-0000-4000-8000-000000000003' AND entry_number=2)
   OR (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev THEN
   RAISE EXCEPTION 'occupied-seat failure must roll back newly materialized projection and revision';
 END IF;
 DELETE FROM public.tournament_entries WHERE id='f7350000-0000-4000-8000-000000000032';
 PERFORM set_config('role','authenticated',true);
 IF current_setting('test.assign_free_sit_roundtrip')::boolean THEN
   PERFORM set_config('role','none',true);
   IF current_setting('test.assign_manual_entry')::boolean THEN
     UPDATE public.tournament_seats SET player_name='Manual roundtrip TEST'
       WHERE entry_id='f7350000-0000-4000-8000-000000000031' AND is_active;
   END IF;
   SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=session_id;
   PERFORM set_config('role','authenticated',true);
   result:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch,20000,free_request_id,'assign projection regression');
   RAISE NOTICE 'PUBLIC_FREE_SIT_RESULT=%',result;
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'free sit failed: %',result; END IF;
   replay:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch,20000,free_request_id,'assign projection regression');
   IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'free sit same payload must replay original receipt'; END IF;
   replay:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch,19999,free_request_id,'assign projection regression');
   IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'free sit changed stack must conflict'; END IF;
   replay:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev+1,epoch,20000,free_request_id,'assign projection regression');
   IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'free sit changed revision must conflict'; END IF;
   replay:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch+1,20000,free_request_id,'assign projection regression');
   IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'free sit changed epoch must conflict'; END IF;
   replay:=public.floor_free_sit_player_v1('f7350000-0000-4000-8000-000000000031',rev,epoch,20000,free_request_id,'different reason');
   IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'free sit changed reason must conflict'; END IF;
   projection:=public.get_tournament_participation_v1('f7350000-0000-4000-8000-000000000003');
   IF (projection->'counts'->>'waiting')::integer<>1 OR (projection->'counts'->>'live_entry_stack')::bigint<>20000 THEN
     RAISE EXCEPTION 'free sit must preserve waiting entry and stack';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.get_floor_seatable_entries('f7350000-0000-4000-8000-000000000003')
     WHERE entry_id='f7350000-0000-4000-8000-000000000031' AND current_stack=20000) THEN
     RAISE EXCEPTION 'released participation must be available through public waiting picker';
   END IF;
   IF current_setting('test.assign_manual_entry')::boolean AND NOT EXISTS(
     SELECT 1 FROM public.get_floor_seatable_entries('f7350000-0000-4000-8000-000000000003')
     WHERE entry_id='f7350000-0000-4000-8000-000000000031' AND display_name='Manual roundtrip TEST') THEN
     RAISE EXCEPTION 'manual waiting picker must preserve canonical retained name';
   END IF;
   PERFORM set_config('role','none',true);
   SELECT revision INTO rev FROM public.table_sessions WHERE id=session_id;
   IF current_setting('test.assign_manual_entry')::boolean THEN
     UPDATE public.tournament_entries SET source='online'
       WHERE id='f7350000-0000-4000-8000-000000000031';
     PERFORM set_config('role','authenticated',true);
     IF EXISTS(SELECT 1 FROM public.get_floor_seatable_entries('f7350000-0000-4000-8000-000000000003')
       WHERE entry_id='f7350000-0000-4000-8000-000000000031') THEN
       RAISE EXCEPTION 'unregistered nonmanual entry must not enter waiting picker';
     END IF;
     replay:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,2,rev,gen_random_uuid());
     IF replay->>'ok' IS DISTINCT FROM 'false' OR replay->>'error' IS DISTINCT FROM 'entry_not_seatable' THEN
       RAISE EXCEPTION 'unregistered nonmanual entry must remain denied: %',replay;
     END IF;
     PERFORM set_config('role','none',true);
     IF (SELECT revision FROM public.table_sessions WHERE id=session_id) IS DISTINCT FROM rev THEN
       RAISE EXCEPTION 'denied nonmanual assign changed revision';
     END IF;
     UPDATE public.tournament_entries SET source='manual'
       WHERE id='f7350000-0000-4000-8000-000000000031';
   END IF;
   PERFORM set_config('role','authenticated',true);
   result:=public.floor_assign_entry_to_seat_v4('f7350000-0000-4000-8000-000000000031',tt,2,rev,gen_random_uuid());
 END IF;
 projection:=public.get_tournament_participation_v1('f7350000-0000-4000-8000-000000000003');
 PERFORM set_config('role','none',true);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'assign failed: %',result; END IF;
 RAISE NOTICE 'ASSIGN_PUBLIC_PROJECTION=%',projection;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'seats') s
   WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
    AND s->>'participation_status'='seated' AND s->>'table_id'=tt::text
    AND s->>'table_session_id'=session_id::text AND (s->>'chip_count')::bigint=20000) THEN
  RAISE EXCEPTION 'assigned entry must remain valid seated participation with exact tuple';
 END IF;
 IF current_setting('test.assign_malformed_roster_alias')='true' THEN
   PERFORM set_config('role','authenticated',true);
   IF NOT EXISTS(SELECT 1 FROM public.get_floor_tournament_table_roster_v6('f7350000-0000-4000-8000-000000000003') r
     CROSS JOIN LATERAL jsonb_array_elements(r.seats) s
     WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
       AND s->>'integrity_status'='valid') THEN
     RAISE EXCEPTION 'qualified occupied seat must remain actionable';
   END IF;
   PERFORM set_config('role','none',true);
   IF has_function_privilege('anon','public.get_floor_tournament_table_roster_v6(uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.get_floor_tournament_table_roster_v6(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_floor_tournament_table_roster_v6(uuid)','EXECUTE') THEN
     RAISE EXCEPTION 'roster v6 ACL mismatch';
   END IF;
   -- Isolated malformed legacy alias; preserve canonical tuple, entry and chips.
   UPDATE public.tournament_seats SET table_id=NULL
    WHERE entry_id='f7350000-0000-4000-8000-000000000031' AND is_active;
   PERFORM set_config('role','authenticated',true);
   projection:=public.get_tournament_participation_v1('f7350000-0000-4000-8000-000000000003');
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'seats') s
     WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
       AND s->>'participation_status'='anomaly') THEN
     RAISE EXCEPTION 'malformed alias must remain visible invalid';
   END IF;
   IF EXISTS(SELECT 1 FROM public.get_floor_tournament_table_roster_v6('f7350000-0000-4000-8000-000000000003') r
     CROSS JOIN LATERAL jsonb_array_elements(r.seats) s
     WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
       AND s->>'integrity_status'='valid') THEN
     RAISE EXCEPTION 'roster exposes anomalous participation as actionable valid seat';
   END IF;
   IF (SELECT count(*) FROM public.get_floor_tournament_table_roster_v6('f7350000-0000-4000-8000-000000000003') r
     CROSS JOIN LATERAL jsonb_array_elements(r.seats) s
     WHERE s->>'entry_id'='f7350000-0000-4000-8000-000000000031'
       AND s->>'integrity_status'='invalid_participation'
       AND (s->>'chip_count')::bigint=20000) <> 1 THEN
     RAISE EXCEPTION 'anomalous occupied seat must remain visible once with preserved chips';
   END IF;
   PERFORM set_config('role','none',true);
   IF (SELECT current_stack FROM public.tournament_entries WHERE id='f7350000-0000-4000-8000-000000000031') IS DISTINCT FROM 20000
     OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id='f7350000-0000-4000-8000-000000000031' AND is_active
       AND table_id IS NULL AND tournament_table_id=tt AND table_session_id=session_id AND chip_count=20000) <> 1 THEN
     RAISE EXCEPTION 'roster read changed canonical occupancy or stack';
   END IF;
   PERFORM set_config('request.jwt.claim.sub','f7350000-0000-4000-8000-000000000099',true);
   PERFORM set_config('role','authenticated',true);
   BEGIN
     PERFORM * FROM public.get_floor_tournament_table_roster_v6('f7350000-0000-4000-8000-000000000003');
     RAISE EXCEPTION 'foreign actor accepted by roster v6';
   EXCEPTION WHEN insufficient_privilege THEN NULL;
   END;
   PERFORM set_config('role','none',true);
 END IF;
END $$;
ROLLBACK;
