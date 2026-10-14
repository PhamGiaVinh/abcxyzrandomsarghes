\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'tracker_roster_session_test: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7280000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7280000-0000-4000-8000-000000000002','f7280000-0000-4000-8000-000000000001','Roster session TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000002','Roster session TEST','live','playing',1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES
 ('f7280000-0000-4000-8000-000000000003',1,100,100,0,false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7280000-0000-4000-8000-000000000011','f7280000-0000-4000-8000-000000000002','Roster session TEST',72,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','floor_private.set_tracker_roster_seat_core_v1(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)','EXECUTE'),'browser cannot call private core');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','floor_private.set_tracker_roster_seat_core_v1(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)','EXECUTE'),'service cannot bypass private core');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)','EXECUTE'),'anonymous writer denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_tracker_roster_snapshot_v1(uuid,uuid,uuid,bigint)','EXECUTE'),'anonymous snapshot denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','floor_private.tracker_roster_seat_token_v1(uuid,integer)','EXECUTE'),'browser cannot read private token outside authorized snapshot');
\if :{?CLOSED_SESSION_READ_CASE}
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','floor_private.tournament_participation_v1(uuid)','EXECUTE'),'browser cannot bypass participation authorization');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_tournament_participation_v1(uuid)','EXECUTE'),'anonymous cannot read operational participation');
\endif
\if :{?LATE_PHYSICAL_REQUEST_CASE}
SELECT set_config('test.late_physical_request','true',true);
\endif
\if :{?STALE_STACK_FIRST_ARRIVAL_CASE}
SELECT set_config('test.stale_stack_first_arrival','true',true);
\endif
\if :{?CLOSED_SESSION_READ_CASE}
SELECT set_config('test.closed_session_read','true',true);
\endif
\if :{?MOVE_NAME_CASE}
SELECT set_config('test.move_name','true',true);
\endif
\if :{?WRAPPER_RECEIPT_CASE}
SELECT set_config('test.wrapper_receipt','true',true);
\endif
DO $$ DECLARE opened jsonb; old_table uuid; old_session uuid; current_table uuid; current_session uuid; result jsonb; epoch bigint; token text; BEGIN
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'first session opens');
 old_table:=(opened->>'tournament_table_id')::uuid;
 old_session:=(opened->>'table_session_id')::uuid;
 -- Close through the real public seam, preserving the previous incarnation.
 result:=public.close_tournament_table_v3(old_table,1,'f7280000-0000-4000-8000-000000000052');
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'empty session closes');
 opened:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011','manual','f7280000-0000-4000-8000-000000000053');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'physical table reopens');
 current_table:=(opened->>'tournament_table_id')::uuid; current_session:=(opened->>'table_session_id')::uuid;
 PERFORM pg_temp.assert_true(current_table<>old_table,'new tournament table incarnation');
 IF current_setting('test.late_physical_request',true)='true' THEN
  -- Payload was prepared while session A was open. The public legacy seam
  -- carries only its reusable physical ID; deliver it after A closes/B opens.
  result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003','f7280000-0000-4000-8000-000000000011',9,'Late A TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true(NOT COALESCE((result->>'ok')::boolean,false),'late physical request must not write into reopened session B');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND table_session_id=current_session AND is_active),'reopened B remains untouched by late A request');
 END IF;
 result:=public.set_tracker_table_roster_seat('f7280000-0000-4000-8000-000000000003',old_table,1,'Stale TEST',20000,NULL,false,NULL,'f7280000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(result->>'error'='roster_context_required','legacy payload cannot bypass exact context');
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=current_session;
 PERFORM set_config('test.roster_table',current_table::text,true);
 PERFORM set_config('test.roster_session',current_session::text,true);
 PERFORM set_config('test.roster_epoch',epoch::text,true);
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',old_table,old_session,1,'f7280000-0000-4000-8000-000000000065',1,'Old session TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='table_session_mismatch','exact old session cannot write after reopen');
 INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
 VALUES('f7280000-0000-4000-8000-000000000003',current_table,current_session,8,'TEST lock','f7280000-0000-4000-8000-000000000001');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000066',8,'Locked TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='seat_locked','locked empty seat cannot be occupied');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000067',99,'Over capacity TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='bad_seat_number','capacity retained');
 PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000099',true);
 result:=public.get_tracker_roster_snapshot_v1('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch);
 PERFORM pg_temp.assert_true(result->>'error'='actor_not_authorized','outsider snapshot denied');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000068',1,'Outsider TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='actor_not_authorized','outsider cannot write roster');
 PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','authenticated',true);
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'exact context routes to current session');
 PERFORM pg_temp.assert_true(public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000)=result,'same request replay');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000061',1,'A TEST',21000);
 PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','changed payload conflicts');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch-1,'f7280000-0000-4000-8000-000000000063',2,'B TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='STALE_STATE','old epoch rejected');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000062',2,'B TEST',20000);
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'exact current table routes correctly');
 IF current_setting('test.stale_stack_first_arrival',true)='true' THEN
  token:=public.get_tracker_roster_snapshot_v1('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch)->'seats'->0->>'token';
  -- A prepared20k before B committed25k. A has never committed its request;
  -- receipt replay alone cannot protect this delayed first arrival.
  result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,gen_random_uuid(),1,'A TEST',25000,
   (SELECT player_id FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active),false,NULL,token);
  PERFORM pg_temp.assert_true((result->>'ok')::boolean,'B stack update commits');
  result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,gen_random_uuid(),1,'A TEST',20000,
   (SELECT player_id FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active),false,NULL,token);
  PERFORM pg_temp.assert_true(NOT COALESCE((result->>'ok')::boolean,false),'delayed A first arrival cannot overwrite B stack');
  PERFORM pg_temp.assert_true((SELECT chip_count=25000 FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active),'B stack survives delayed A');
  PERFORM pg_temp.assert_true((SELECT e.current_stack=25000 AND cc.chip_count=25000
   FROM public.tournament_seats q JOIN public.tournament_entries e ON e.id=q.entry_id
   JOIN public.tournament_chip_counts cc ON cc.tournament_id=q.tournament_id AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number
   WHERE q.table_session_id=current_session AND q.seat_number=1 AND q.is_active),'all B stack projections survive');
  result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,
   'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000);
  PERFORM pg_temp.assert_true(result->>'ok'='true' AND result->'seat'->>'chip_count'='20000','committed A receipt replay precedes stale CAS');
  PERFORM pg_temp.assert_true((SELECT chip_count=25000 FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active),'A receipt replay does not overwrite B');
  result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,
   'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000,NULL,false,NULL,token);
  PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','same request changed expected token conflicts');
  RETURN;
 END IF;
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(entry_id IS NOT NULL AND tournament_table_id=current_table AND table_session_id=current_session) FROM public.tournament_seats WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND is_active),'canonical seats belong exclusively to reopened session');
 IF current_setting('test.move_name',true)='true' THEN
  -- Real Floor move must not discard the only name of a manual participant.
  -- Subtransaction restores this fixture before other lifecycle assertions.
  BEGIN
   DECLARE moving_entry uuid; moving_player uuid; moving_revision bigint; move_result jsonb;
    second_entry uuid; display_result jsonb; destination jsonb; plan jsonb;
   BEGIN
    SELECT entry_id,player_id INTO moving_entry,moving_player FROM public.tournament_seats
     WHERE table_session_id=current_session AND seat_number=1 AND is_active;
    UPDATE public.tournament_seats SET avatar_url='https://example.test/a.png'
     WHERE entry_id=moving_entry AND is_active;
    SELECT revision INTO moving_revision FROM public.table_sessions WHERE id=current_session;
    PERFORM set_config('role','authenticated',true);
    IF current_setting('test.wrapper_receipt',true)='true' THEN
     move_result:=public.move_player_seat_v3(moving_entry,current_table,3,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    ELSE
     move_result:=public.move_player_seat_v2(moving_entry,current_table,3,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    END IF;
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(move_result->>'ok'='true','named manual entry moves through authenticated public writer');
    PERFORM pg_temp.assert_true((SELECT table_id=current_table
     AND tournament_table_id=current_table AND table_session_id=current_session
     FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid),
     'move preserves canonical participation table/session tuple');
    result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
     WHERE q->>'seat_id'=move_result->>'seat_id' AND q->>'participation_status'='seated'
      AND q->>'table_id'=current_table::text AND q->'anomaly_reason'='null'::jsonb),
     'successful move remains actionable in canonical participation readback');
    PERFORM pg_temp.assert_true((SELECT player_name='A TEST' AND chip_count=20000
     AND avatar_url='https://example.test/a.png'
     FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid),
     'move preserves canonical entry display name and chip evidence');
    PERFORM set_config('role','authenticated',true);
    IF current_setting('test.wrapper_receipt',true)='true' THEN
     result:=public.move_player_seat_v3(moving_entry,current_table,3,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    ELSE
     result:=public.move_player_seat_v2(moving_entry,current_table,3,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    END IF;
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(result=move_result,'named move replay returns original receipt after revision advances');
    PERFORM set_config('role','authenticated',true);
    IF current_setting('test.wrapper_receipt',true)='true' THEN
     result:=public.move_player_seat_v3(moving_entry,current_table,4,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    ELSE
     result:=public.move_player_seat_v2(moving_entry,current_table,4,
      moving_revision,moving_revision,'f7280000-0000-4000-8000-000000000081');
    END IF;
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','named move key cannot change destination');
    IF current_setting('test.wrapper_receipt',true)='true' THEN
     SELECT entry_id INTO second_entry FROM public.tournament_seats
      WHERE table_session_id=current_session AND seat_number=2 AND is_active;
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(second_entry,current_table,3,moving_revision,moving_revision,
      'f7280000-0000-4000-8000-000000000081');
     PERFORM set_config('role','none',true);
     PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','wrapper key binds entry identity');
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(moving_entry,current_table,3,moving_revision+1,moving_revision,
      'f7280000-0000-4000-8000-000000000081');
     PERFORM set_config('role','none',true);
     PERFORM pg_temp.assert_true(result->>'error'='IDEMPOTENCY_CONFLICT','wrapper key binds expected revisions');
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(NULL,current_table,3,moving_revision,moving_revision,
      'f7280000-0000-4000-8000-000000000081');
     PERFORM set_config('role','none',true);
     PERFORM pg_temp.assert_true(result->>'ok'='false','null entry cannot retrieve prior successful receipt');
     INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
      VALUES('f7280000-0000-4000-8000-000000000003',current_table,current_session,3,'Replay TEST lock',
       'f7280000-0000-4000-8000-000000000001');
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(moving_entry,current_table,3,moving_revision,moving_revision,
      'f7280000-0000-4000-8000-000000000081');
     PERFORM set_config('role','none',true);
     PERFORM pg_temp.assert_true(result=move_result,'valid replay survives later destination lock');
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(moving_entry,current_table,3,moving_revision,moving_revision,gen_random_uuid());
     PERFORM set_config('role','none',true);
     PERFORM pg_temp.assert_true(result->>'error'='seat_locked','new intent still enforces destination lock');
     UPDATE public.table_session_seat_locks SET unlocked_at=now(),unlocked_by='f7280000-0000-4000-8000-000000000001'
      WHERE table_session_id=current_session AND seat_number=3;
     PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000099',true);
     PERFORM set_config('role','authenticated',true);
     result:=public.move_player_seat_v3(moving_entry,current_table,3,moving_revision,moving_revision,
      'f7280000-0000-4000-8000-000000000081');
     PERFORM set_config('role','none',true);
     PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
     PERFORM pg_temp.assert_true(result->>'ok'='false','other actor cannot reuse owner receipt');
     PERFORM pg_temp.assert_true((SELECT count(*)=1 AND bool_and(chip_count=20000 AND seat_number=3)
      FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active),'receipt checks do not mutate seat or stack');
    END IF;
    -- Simulate the already-live blank destination, without changing history.
    UPDATE public.tournament_seats SET player_name='' WHERE id=(move_result->>'seat_id')::uuid;
    result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
     WHERE q->>'entry_id'=moving_entry::text AND q->>'player_name'='A TEST')
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(result->'entries') q
     WHERE q->>'id'=moving_entry::text AND q->>'player_name'='A TEST'),
     'participation readers recover exact-entry name of already-blank seat');
    SELECT seats INTO display_result FROM public.get_floor_tournament_table_roster_v5('f7280000-0000-4000-8000-000000000003')
     WHERE table_session_id=current_session;
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(display_result) q
     WHERE q->>'entry_id'=moving_entry::text AND q->>'display_name'='A TEST'),
     'Floor V5 reads historical display evidence without rewriting stored seat');
    SELECT seats INTO display_result FROM public.get_floor_tournament_table_roster_v3('f7280000-0000-4000-8000-000000000003')
     WHERE table_session_id=current_session;
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(display_result) q
     WHERE q->>'entry_id'=moving_entry::text AND q->>'display_name'='A TEST'),'compatibility Floor V3 recovers same name');
    result:=public.get_tracker_roster_snapshot_v1('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch);
    PERFORM pg_temp.assert_true(result->'seats'->2->'seat'->>'player_name'='A TEST','Tracker snapshot recovers name with original token contract');
    PERFORM pg_temp.assert_true((SELECT player_name='' FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid),
     'read fallbacks never repair existing seat data');
    PERFORM pg_temp.assert_true(floor_private.tournament_entry_display_v1(moving_entry,
     'f7280000-0000-4000-8000-000000000099','f7280000-0000-4000-8000-000000000003',1) IS NULL,
     'wrong-player tuple cannot recover a canonical participant name');
    PERFORM pg_temp.assert_true(floor_private.tournament_entry_display_v1(moving_entry,moving_player,
     'f7280000-0000-4000-8000-000000000099',1) IS NULL,'wrong tournament tuple cannot recover display history');
    INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,source,status,current_stack)
     VALUES('f7280000-0000-4000-8000-000000000003',moving_player,2,'manual','registered',20000)
     RETURNING id INTO second_entry;
    PERFORM pg_temp.assert_true(floor_private.tournament_entry_display_v1(second_entry,moving_player,
     'f7280000-0000-4000-8000-000000000003',2)->>'player_name' IS NULL,
     'another entry generation never inherits prior generation display evidence');
    PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','EXECUTE')
     AND NOT has_function_privilege('anon','floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','EXECUTE')
     AND NOT has_function_privilege('service_role','floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)','EXECUTE'),
     'private display helper does not expose entry metadata through direct RPC');
    -- An explicit avatar clear must not resurrect an older historical image.
    token:=public.get_tracker_roster_snapshot_v1('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch)->'seats'->2->>'token';
    PERFORM set_config('role','authenticated',true);
    result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,
     gen_random_uuid(),3,'A TEST',20000,moving_player,true,NULL,token);
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(result->>'ok'='true','public explicit avatar clear commits');
    -- Deterministic tied timestamps: UUID ordering must not choose an older
    -- nonblank avatar after the current source is deactivated by the writer.
    INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,entry_id,
     tournament_table_id,table_session_id,seat_number,chip_count,is_active,status,player_name,avatar_url,created_at)
    SELECT 'ffffffff-ffff-4fff-8fff-fffffffffff1',tournament_id,player_id,entry_number,entry_id,
     tournament_table_id,table_session_id,9,chip_count,false,'moved',player_name,'https://example.test/older.png',created_at
    FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid;
    SELECT revision INTO moving_revision FROM public.table_sessions WHERE id=current_session;
    PERFORM set_config('role','authenticated',true);
    move_result:=public.move_player_seat_v2(moving_entry,current_table,4,moving_revision,moving_revision,gen_random_uuid());
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(move_result->>'ok'='true','cleared-avatar entry moves through public writer');
    PERFORM pg_temp.assert_true((SELECT avatar_url IS NULL AND player_name='A TEST' AND chip_count=20000
     FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid),'ordinary move retains explicit avatar clear');
    -- Immediate break uses the same insertion seam and name-aware plan reader.
    INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
     VALUES('f7280000-0000-4000-8000-000000000012','f7280000-0000-4000-8000-000000000002','Named break destination TEST',73,'tournament','inactive','available');
    destination:=public.floor_open_tournament_table_v3('f7280000-0000-4000-8000-000000000003',
     'f7280000-0000-4000-8000-000000000012','manual',gen_random_uuid());
    PERFORM pg_temp.assert_true(destination->>'ok'='true','immediate named break destination opens');
    -- Reproduce the live known source: exact entry/session, missing legacy
    -- logical alias. Only the verified new destination is written by move.
    UPDATE public.tournament_seats SET table_id=NULL
     WHERE entry_id=moving_entry AND is_active;
    SELECT revision INTO moving_revision FROM public.table_sessions WHERE id=current_session;
    PERFORM set_config('role','authenticated',true);
    move_result:=public.move_player_seat_v2(moving_entry,(destination->>'tournament_table_id')::uuid,1,
     moving_revision,1,gen_random_uuid());
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(move_result->>'ok'='true','evidenced alias-null source moves to another exact session');
    result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
     WHERE q->>'seat_id'=move_result->>'seat_id' AND q->>'participation_status'='seated'
      AND q->>'table_id'=destination->>'tournament_table_id'
      AND q->>'table_session_id'=destination->>'table_session_id'),
     'cross-table move repairs only new destination tuple via canonical writer');
    PERFORM pg_temp.assert_true((SELECT chip_count=20000 AND avatar_url IS NULL AND player_name='A TEST'
     FROM public.tournament_seats WHERE id=(move_result->>'seat_id')::uuid),
     'cross-table move preserves stack/name/explicit avatar clear');
    result:=public.move_player_seat_v2(moving_entry,gen_random_uuid(),1,2,1,gen_random_uuid());
    PERFORM pg_temp.assert_true(result->>'ok'='false','unrelated nonexistent destination denied');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 AND bool_and(table_session_id=(destination->>'table_session_id')::uuid)
     FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active),
     'denied destination does not mutate current source');
    SELECT revision INTO moving_revision FROM public.table_sessions WHERE id=current_session;
    PERFORM set_config('role','authenticated',true);
    move_result:=public.move_player_seat_v2(moving_entry,current_table,4,2,moving_revision,gen_random_uuid());
    PERFORM set_config('role','none',true);
    PERFORM pg_temp.assert_true(move_result->>'ok'='true','cross-table roundtrip returns to original session');
    SELECT revision INTO moving_revision FROM public.table_sessions WHERE id=current_session;
    plan:=public.floor_plan_break_table_v1(current_table,moving_revision,'fill_lowest_table');
    PERFORM pg_temp.assert_true(plan->>'ok'='true' AND plan->>'complete'='true','immediate named break plan complete');
    result:=public.floor_break_table_v5(current_table,moving_revision,gen_random_uuid(),'fill_lowest_table',plan->>'plan_hash');
    PERFORM pg_temp.assert_true(result->>'ok'='true','immediate named break commits');
    result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
    PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(q->>'participation_status'='seated'
      AND q->>'table_id'=destination->>'tournament_table_id'
      AND q->>'table_session_id'=destination->>'table_session_id')
     FROM jsonb_array_elements(result->'seats') q),
     'immediate break readback keeps every moved entry in destination participation scope');
    PERFORM pg_temp.assert_true((SELECT player_name='A TEST' AND avatar_url IS NULL
     AND chip_count=20000 FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active),
     'immediate break retains name and explicit avatar clear');
    PERFORM pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=current_session),
     'metadata preservation does not change explicit break closure');
    RAISE no_data_found;
   EXCEPTION WHEN no_data_found THEN NULL; END;
  END;
 END IF;
 IF current_setting('test.closed_session_read',true)='true' THEN
  -- Attack each stack projection independently before the lifecycle anomaly.
  BEGIN
   DELETE FROM public.tournament_chip_counts cc USING public.tournament_seats q
    WHERE q.table_session_id=current_session AND q.seat_number=1 AND q.is_active
      AND cc.tournament_id=q.tournament_id AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number;
   result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
   PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
    WHERE q->>'seat_number'='1' AND q->>'anomaly_reason'='stack_projection_mismatch'
      AND q->'projected_stack'='null'::jsonb),
    'missing chip projection stays visible-invalid with missing evidence');
   -- Roll back only this disposable attack; no source evidence is repaired.
   RAISE no_data_found;
  EXCEPTION WHEN no_data_found THEN NULL; END;
  UPDATE public.tournament_entries SET current_stack=25000 WHERE id=(
    SELECT entry_id FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active);
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
    WHERE q->>'table_session_id'=current_session::text AND q->>'seat_number'='1'
      AND q->>'participation_status'='anomaly' AND q->>'anomaly_reason'='stack_projection_mismatch'),
    'entry-seat stack mismatch must not remain actionable seated');
  UPDATE public.tournament_entries SET current_stack=20000 WHERE id=(
    SELECT entry_id FROM public.tournament_seats WHERE table_session_id=current_session AND seat_number=1 AND is_active);
  UPDATE public.tournament_chip_counts cc SET chip_count=30000 FROM public.tournament_seats q
    WHERE q.table_session_id=current_session AND q.seat_number=1 AND q.is_active
      AND cc.tournament_id=q.tournament_id AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number;
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
    WHERE q->>'seat_number'='1' AND q->>'anomaly_reason'='stack_projection_mismatch'),
    'chip projection mismatch must not remain actionable seated');
  UPDATE public.tournament_chip_counts cc SET chip_count=20000 FROM public.tournament_seats q
    WHERE q.table_session_id=current_session AND q.seat_number=1 AND q.is_active
      AND cc.tournament_id=q.tournament_id AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number;
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_true(result->'counts'->>'seated'='2'
    AND result->'counts'->>'seated_stack'='40000' AND result->'counts'->>'live_entry_stack'='40000',
    'restored consistent projections return valid seating without chip loss');
  -- Disposable legacy anomaly: retain canonical entry/chips, but one active
  -- seat belongs to an earlier closed incarnation. Never run on live data.
  UPDATE public.tournament_seats SET tournament_table_id=old_table,
    table_id=old_table,table_session_id=old_session
  WHERE tournament_id='f7280000-0000-4000-8000-000000000003'
    AND table_session_id=current_session AND seat_number=2 AND is_active;
  PERFORM pg_temp.assert_true((SELECT count(*)=2 AND sum(chip_count)=40000
    FROM public.tournament_seats
    WHERE tournament_id='f7280000-0000-4000-8000-000000000003' AND is_active),
    'read classification must preserve legacy seat rows and chip evidence');
  PERFORM pg_temp.assert_true(EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.get_seats_for_draw(
      'f7280000-0000-4000-8000-000000000003')) exposed
    JOIN public.tournament_seats seat ON seat.id=(exposed->>'seat_id')::uuid
    WHERE seat.table_session_id=current_session AND seat.seat_number=1
  ),'valid current-session player remains visible');
  PERFORM pg_temp.assert_true(NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.get_seats_for_draw(
      'f7280000-0000-4000-8000-000000000003')) exposed
    JOIN public.tournament_seats seat ON seat.id=(exposed->>'seat_id')::uuid
    JOIN public.table_sessions session ON session.id=seat.table_session_id
    WHERE session.closed_at IS NOT NULL
  ),'ordinary playing roster cannot expose closed-session seats as active');
  PERFORM set_config('role','authenticated',true);
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(result->'counts'->>'seated'='1'
    AND result->'counts'->>'anomaly_seats'='1'
    AND result->'counts'->>'total_entries'='2'
    AND result->'counts'->>'remaining'='2'
    AND result->'counts'->>'live_entry_stack'='40000'
    AND result->'counts'->>'seated_stack'='20000',
    'entry participation is conserved while current seating excludes anomaly');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
    WHERE q->>'table_session_id'=old_session::text
      AND q->>'participation_status'='anomaly' AND q->>'anomaly_reason'='closed_session'),
    'closed-session seat remains visible-invalid with explicit reason');
  PERFORM set_config('role','authenticated',true);
  result:=public.get_tournament_participation_counts_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(result->'counts'->>'total_entries'='2'
    AND result->>'average_stack'='20000' AND NOT(result ? 'seats') AND NOT(result ? 'entries'),
    'authenticated TV gets canonical aggregates without private rows');
  INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
  VALUES('f7280000-0000-4000-8000-000000000071','f7280000-0000-4000-8000-000000000002',
    'fixture-only-participation-display-token-not-live',
    'f7280000-0000-4000-8000-000000000003','paired');
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',false);
  PERFORM pg_temp.assert_true(result->>'status'='paired'
    AND result->'entries'->>'total_confirmed'='2'
    AND result->>'re_entries'='0'
    AND result->'tournament'->>'players_remaining'='2'
    AND NOT(result ? 'seats') AND NOT(result ? 'entries_private'),
    'anonymous paired display gets only assigned tournament aggregates');
  PERFORM pg_temp.assert_true(public.get_tv_display_state_v4('invalid',false)->>'status'='invalid',
    'invalid display capability rejected');
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',true);
  PERFORM pg_temp.assert_true(result->>'status'='paired'
    AND result->'entries'->>'total_confirmed'='2'
    AND result->'display' ? 'club_layout',
    'branding-enabled paired reader preserves branding and canonical aggregates');
  BEGIN
    PERFORM public.get_tournament_participation_counts_v1('f7280000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'anonymous direct counts accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('role','none',true);
  INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level)
    VALUES('f7280000-0000-4000-8000-000000000005','f7280000-0000-4000-8000-000000000002',
      'Separate flight TEST','live','playing',1);
  UPDATE public.tv_displays SET assigned_tournament_id='f7280000-0000-4000-8000-000000000005'
    WHERE id='f7280000-0000-4000-8000-000000000071';
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',false);
  PERFORM pg_temp.assert_true(result->'tournament'->>'id'='f7280000-0000-4000-8000-000000000005'
    AND result->'entries'->>'total_confirmed'='0'
    AND result->'tournament'->>'players_remaining'='0',
    'display reassignment does not retain prior flight participation');
  PERFORM set_config('role','none',true);
  UPDATE public.tv_displays SET status='revoked' WHERE id='f7280000-0000-4000-8000-000000000071';
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',true);
  PERFORM pg_temp.assert_true(result->>'status'='revoked' AND NOT(result ? 'participation_counts'),
    'revoked token cannot retrieve participation');
  PERFORM set_config('role','none',true);
  INSERT INTO public.clubs(id,owner_id,name,region) VALUES
    ('f7280000-0000-4000-8000-000000000006','f7280000-0000-4000-8000-000000000001','Foreign display TEST','TEST');
  UPDATE public.tv_displays SET status='paired',club_id='f7280000-0000-4000-8000-000000000006'
    WHERE id='f7280000-0000-4000-8000-000000000071';
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',true);
  PERFORM pg_temp.assert_true(result=jsonb_build_object('status','invalid'),
    'cross-club display assignment reveals no tournament or branding');
  PERFORM set_config('role','none',true);
  UPDATE public.tv_displays SET club_id='f7280000-0000-4000-8000-000000000002'
    WHERE id='f7280000-0000-4000-8000-000000000071';
  UPDATE public.tournaments SET deleted_at=now() WHERE id='f7280000-0000-4000-8000-000000000005';
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',false);
  PERFORM pg_temp.assert_true(result=jsonb_build_object('status','invalid'),
    'deleted assigned tournament reveals no aggregate or clock');
  PERFORM set_config('role','none',true);
  UPDATE public.tv_displays SET display_token='fixture-only-rotated-display-capability-not-live'
    WHERE id='f7280000-0000-4000-8000-000000000071';
  PERFORM set_config('role','anon',true);
  result:=public.get_tv_display_state_v4('fixture-only-participation-display-token-not-live',true);
  PERFORM pg_temp.assert_true(result=jsonb_build_object('status','invalid'),
    'old rotated capability cannot retrieve display data');
  RAISE NOTICE 'PARTICIPATION_TV_CAPABILITY_TENANT_DELETION_ROTATION_PASS';
  PERFORM set_config('role','none',true);
  -- Historical seating must not mint an entry or count as a re-entry.
  INSERT INTO public.tournament_seats(tournament_id,player_id,entry_number,table_id,
    seat_number,chip_count,is_active,status,entry_id,tournament_table_id,table_session_id)
  SELECT tournament_id,player_id,entry_number,old_table,3,chip_count,false,'moved',
    entry_id,old_table,old_session FROM public.tournament_seats
  WHERE table_session_id=current_session AND seat_number=1 AND is_active;
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_true(result->'counts'->>'total_entries'='2'
    AND result->'counts'->>'re_entries'='0' AND jsonb_array_length(result->'seats')=2,
    'historical seat rows do not increase entry or re-entry counts');
  UPDATE public.tournament_seats SET entry_id=NULL
    WHERE table_session_id=current_session AND seat_number=1 AND is_active;
  IF current_setting('test.null_alias_anomaly',true)='true' THEN
    UPDATE public.tournament_seats SET table_id=NULL
      WHERE table_session_id=current_session AND seat_number=1 AND is_active;
    PERFORM set_config('role','authenticated',true);
  END IF;
  result:=public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
  IF current_setting('test.null_alias_anomaly',true)='true' THEN
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(result->'seats') q
      WHERE q->>'table_id' IS NULL AND q->>'participation_status'='anomaly'
        AND q->>'anomaly_reason'='missing_entry'),
      'authenticated public projection preserves NULL alias as invalid occupancy');
    RAISE NOTICE 'NULL_ALIAS_PUBLIC_PROJECTION=%',result;
    PERFORM set_config('role','none',true);
  END IF;
  PERFORM pg_temp.assert_true(result->'counts'->>'seated'='0' AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(result->'seats') q
    WHERE q->>'table_session_id'=current_session::text AND q->>'anomaly_reason'='missing_entry'),
    'missing-entry occupancy is visible-invalid, not empty or valid');
  PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000099',true);
  BEGIN
    PERFORM public.get_tournament_participation_v1('f7280000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'outsider read was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','f7280000-0000-4000-8000-000000000001',true);
  RETURN;
 END IF;
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=current_session RETURNING control_epoch INTO epoch;
 -- Exercise the actual writer, not a hand INSERT with a convenient logical ID.
 result:=public.start_tracker_hand_v3('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,1,now(),'f7280000-0000-4000-8000-000000000001',1);
 PERFORM pg_temp.assert_true(result->>'status'='success','public V3 start accepts canonical roster');
 PERFORM pg_temp.assert_true((SELECT table_id=current_table AND tournament_table_id=current_table AND table_session_id=current_session AND tracker_small_blind=100 AND tracker_big_blind=100 AND tracker_sb_position=1 AND tracker_bb_position=2 FROM public.tournament_hands WHERE id=(result->>'hand_id')::uuid),'hand uses logical FK and exact-session blind lineage');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players WHERE hand_id=(result->>'hand_id')::uuid),'same roster and chip sum frozen');
 result:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',current_table,current_session,epoch,'f7280000-0000-4000-8000-000000000064',3,'During hand TEST',20000);
 PERFORM pg_temp.assert_true(result->>'error'='hand_in_progress','roster remains locked while hand active');
END $$;
-- Only public RPC calls under the actual browser role; privileged fixture
-- setup and DB assertions stay outside this section.
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',
  current_setting('test.roster_table')::uuid,current_setting('test.roster_session')::uuid,
  current_setting('test.roster_epoch')::bigint,'f7280000-0000-4000-8000-000000000061',1,'A TEST',20000);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->'seat'->>'chip_count'<>'20000' THEN
  RAISE EXCEPTION 'authenticated receipt replay failed: %',r; END IF;
 r:=public.set_tracker_table_roster_seat_v2('f7280000-0000-4000-8000-000000000003',
  current_setting('test.roster_table')::uuid,current_setting('test.roster_session')::uuid,
  current_setting('test.roster_epoch')::bigint,'f7280000-0000-4000-8000-000000000061',1,'Changed TEST',20000);
 IF r->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'authenticated payload conflict failed'; END IF;
 BEGIN
  PERFORM floor_private.set_tracker_roster_seat_core_v1(NULL,NULL,1,'Bypass',20000,NULL,false,NULL,auth.uid());
  RAISE EXCEPTION 'private core browser bypass';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\if :{?LEGACY_REENTRY_RETIREMENT_CASE}
\ir legacyReentryRetirement.pg17.sql
\endif
\if :{?LEGACY_STACK_INTEGRITY_CASE}
\ir legacyStackIntegrity.pg17.sql
\endif
ROLLBACK;
