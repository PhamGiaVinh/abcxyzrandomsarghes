\set ON_ERROR_STOP on
-- Isolated fresh production-schema qualification only; no business helper replacement.
CREATE FUNCTION public.floor_table_v3_assert(p_condition boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Floor345 assertion failed: %',p_message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000003');
INSERT INTO public.clubs(id,owner_id,name,region,bot_enabled) VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','TEST Floor345','TEST',false);
-- The schema-only restore intentionally contains no release configuration rows.
-- Configure only this isolated fixture club through the real release table.
SELECT public.floor_table_v3_assert(NOT centerpoint_private.tournament_ops_release_allowed_v1('00000000-0000-0000-0000-000000000010'),'unconfigured club is release-closed');
INSERT INTO public.centerpoint_tournament_ops_release(id,enabled,allowed_club_ids)
VALUES(true,true,ARRAY['00000000-0000-0000-0000-000000000010'::uuid]);
SELECT public.floor_table_v3_assert(centerpoint_private.tournament_ops_release_allowed_v1('00000000-0000-0000-0000-000000000010'),'fixture club explicitly released');
SELECT public.floor_table_v3_assert(NOT centerpoint_private.tournament_ops_release_allowed_v1('00000000-0000-0000-0000-000000000011'),'other club remains release-closed');
CREATE SCHEMA fast_bust_test;
CREATE FUNCTION fast_bust_test.seed(mode text DEFAULT 'manual', entry_kind text DEFAULT 'valid')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); opened jsonb; tt uuid; sess uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES
 (t,'00000000-0000-0000-0000-000000000010','TEST Floor345','active','playing');
 -- Actual club creation initializes its 100-table inventory. Use an unused real row.
 SELECT gt.id INTO STRICT g FROM public.game_tables gt
 WHERE gt.club_id='00000000-0000-0000-0000-000000000010'
 AND gt.operational_status='available'
 AND NOT EXISTS(SELECT 1 FROM public.tournament_tables tt WHERE tt.game_table_id=gt.id)
 ORDER BY gt.table_number LIMIT 1;
 opened:=public.floor_open_tournament_table_v3(t,g,mode,gen_random_uuid());
 PERFORM public.floor_table_v3_assert(opened->>'ok'='true','fixture table opens: '||opened::text);
 tt:=(opened->>'tournament_table_id')::uuid; sess:=(opened->>'table_session_id')::uuid;
 IF entry_kind<>'missing' THEN
  INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack)
  VALUES(e,t,p,1,'seated',1000);
 ELSE e:=NULL; END IF;
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,
  tournament_table_id,table_session_id,seat_number,chip_count,entry_id,is_active,status)
 VALUES(s,t,p,1,tt,tt,sess,1,1000,e,true,'active');
 RETURN jsonb_build_object('tour',t,'table',tt,'session',sess,'seat',s,'player',p,'entry',e,'number',1,'epoch',1);
END $$;

-- SET ROLE is inside the invoker helper solely to grade the actual RPC as the
-- browser role. Fixture preparation and assertions remain session-admin work.
CREATE FUNCTION fast_bust_test.invoke(c jsonb, request uuid DEFAULT gen_random_uuid(),
 reason text DEFAULT 'TEST Floor confirmed out') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 SET LOCAL ROLE authenticated;
 IF current_user<>'authenticated' THEN RAISE EXCEPTION 'ungraded caller'; END IF;
 r:=public.floor_operator_bust_seat_v1((c->>'tour')::uuid,(c->>'table')::uuid,
 (c->>'session')::uuid,(c->>'seat')::uuid,(c->>'player')::uuid,(c->>'number')::integer,
 (c->>'entry')::uuid,(c->>'epoch')::bigint,request,reason);
 RESET ROLE;
 RETURN r;
END $$;

CREATE FUNCTION fast_bust_test.disturb_chip_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('fast_bust_test.disturb_seat',true)=NEW.id::text AND NEW.chip_count=0 THEN NEW.chip_count:=5; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_disturb_chip_update BEFORE UPDATE OF chip_count ON public.tournament_seats
 FOR EACH ROW EXECUTE FUNCTION fast_bust_test.disturb_chip_update();

DO $$
DECLARE c jsonb; r jsonb; again jsonb; req uuid; old_revision bigint; other uuid;
BEGIN
 c:=fast_bust_test.seed(); req:=gen_random_uuid();
 SET LOCAL ROLE authenticated;
 r:=public.get_floor_tournament_table_roster_v7((c->>'tour')::uuid);
 RESET ROLE;
 PERFORM public.floor_table_v3_assert((r#>>'{0,seats,0,seat_id}')=(c->>'seat')
  AND (r#>>'{0,seats,0,seat_entry_id}')=(c->>'entry'),'authorized roster carries exact row identity');
 SELECT revision INTO old_revision FROM public.table_sessions WHERE id=(c->>'session')::uuid;
 -- Changes to unrelated roster revision no longer stale this exact-seat intent.
 UPDATE public.table_sessions SET revision=revision+10 WHERE id=(c->>'session')::uuid;
 r:=fast_bust_test.invoke(c,req); again:=fast_bust_test.invoke(c,req);
 PERFORM public.floor_table_v3_assert(r->>'outcome'='busted' AND r=again,'canonical bust + retry');
 PERFORM public.floor_table_v3_assert((SELECT status='busted' AND current_stack=0 FROM public.tournament_entries WHERE id=(c->>'entry')::uuid),'canonical entry transition');
 PERFORM public.floor_table_v3_assert((SELECT revision=old_revision+11 FROM public.table_sessions WHERE id=(c->>'session')::uuid),'one effective revision');
 PERFORM public.floor_table_v3_assert((fast_bust_test.invoke(c,req,'different intent')->>'error')='IDEMPOTENCY_CONFLICT','conflicting retry');
 PERFORM public.floor_table_v3_assert((fast_bust_test.invoke(c)->>'error')='seat_identity_changed','fresh duplicate fenced');

 c:=fast_bust_test.seed('manual','missing');
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'outcome'='orphan_seat_released' AND r->>'payout_applied'='false','orphan cleanup distinct');
 PERFORM public.floor_table_v3_assert((SELECT count(*)=0 FROM public.tournament_entries WHERE tournament_id=(c->>'tour')::uuid),'no fabricated registration');
 PERFORM public.floor_table_v3_assert((SELECT status='cancelled' AND NOT is_active AND chip_count=1000 FROM public.tournament_seats WHERE id=(c->>'seat')::uuid),'orphan cleanup preserves historical chips');
 r:=public.close_tournament_table_v3((c->>'table')::uuid,(r->>'revision')::bigint,gen_random_uuid());
 PERFORM public.floor_table_v3_assert(r->>'ok'='true','empty table closes after orphan cleanup');

 c:=fast_bust_test.seed(); other:=gen_random_uuid();
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack)
 VALUES(other,(c->>'tour')::uuid,gen_random_uuid(),1,'seated',2222);
 UPDATE public.tournament_seats SET entry_id=other WHERE id=(c->>'seat')::uuid;
 c:=jsonb_set(c,'{entry}',to_jsonb(other)); r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'outcome'='orphan_seat_released','mismatched entry cleanup');
 PERFORM public.floor_table_v3_assert((SELECT status='seated' AND current_stack=2222 FROM public.tournament_entries WHERE id=other),'other player entry untouched');

 c:=fast_bust_test.seed('tracker');
 INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count,updated_at) VALUES((c->>'tour')::uuid,(c->>'player')::uuid,1,777,now());
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'outcome'='busted' AND r#>>'{before,tracker_chip_count}'='777' AND r#>>'{before,seat_chip_count}'='1000','tracker correction audited');
 PERFORM public.floor_table_v3_assert((SELECT chip_count=0 FROM public.tournament_chip_counts WHERE tournament_id=(c->>'tour')::uuid),'tracker counter cleared');
 c:=fast_bust_test.seed('tracker'); r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'outcome'='busted','missing tracker counter supported');

 c:=fast_bust_test.seed('tracker'); req:=gen_random_uuid();
 PERFORM floor_private.floor_table_v3_save_receipt(auth.uid(),'floor_bust_player_v3',req,'conflict','{"ok":true}'::jsonb);
 r:=fast_bust_test.invoke(c,req);
 PERFORM public.floor_table_v3_assert(r->>'error'='IDEMPOTENCY_CONFLICT','canonical rejection retained');
 PERFORM public.floor_table_v3_assert((SELECT chip_count=1000 AND is_active FROM public.tournament_seats WHERE id=(c->>'seat')::uuid),'failed bust rolls back seat correction');
 PERFORM public.floor_table_v3_assert(NOT EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id=(c->>'tour')::uuid),'failed bust rolls back inserted counter');
 PERFORM public.floor_table_v3_assert(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id=req AND operation_type='floor_operator_bust_seat_v1'),'no success receipt for failed bust');

 c:=fast_bust_test.seed('tracker');
 PERFORM set_config('fast_bust_test.disturb_seat',c->>'seat',false);
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'error'='STALE_STATE','canonical business failure after correction');
 PERFORM public.floor_table_v3_assert((SELECT chip_count=1000 AND is_active FROM public.tournament_seats WHERE id=(c->>'seat')::uuid),'subtransaction rolls back correction');
 PERFORM public.floor_table_v3_assert(NOT EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id=(c->>'tour')::uuid),'subtransaction rolls back counter insert');
 PERFORM set_config('fast_bust_test.disturb_seat','',false);

 c:=fast_bust_test.seed();
 WITH held AS (
  INSERT INTO public.tournament_redraw_batches(tournament_id,target_max_seats,target_game_table_ids,snapshot_fingerprint,planned_by)
  SELECT (c->>'tour')::uuid,9,ARRAY[game_table_id],'TEST hold fence',auth.uid()
  FROM public.table_sessions WHERE id=(c->>'session')::uuid RETURNING id,redraw_revision
 ) UPDATE public.table_sessions SET redraw_hold_batch_id=held.id,redraw_hold_revision=held.redraw_revision,redraw_hold_at=now()
 FROM held WHERE table_sessions.id=(c->>'session')::uuid;
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'error'='redraw_in_progress','hold fence');
 UPDATE public.table_sessions SET redraw_hold_batch_id=NULL,redraw_hold_revision=NULL,redraw_hold_at=NULL WHERE id=(c->>'session')::uuid;
 r:=fast_bust_test.invoke(jsonb_set(c,'{seat}',to_jsonb(gen_random_uuid())));
 PERFORM public.floor_table_v3_assert(r->>'error'='seat_identity_changed','stale seat ID');
 r:=fast_bust_test.invoke(jsonb_set(c,'{player}',to_jsonb(gen_random_uuid())));
 PERFORM public.floor_table_v3_assert(r->>'error'='seat_identity_changed','stale player identity');
 r:=fast_bust_test.invoke(jsonb_set(c,'{epoch}','2'));
 PERFORM public.floor_table_v3_assert(r->>'error'='table_session_mismatch','control epoch fence');
 INSERT INTO public.tournament_hands(tournament_id,table_id,tournament_table_id,table_session_id,status)
 VALUES((c->>'tour')::uuid,(c->>'table')::uuid,(c->>'table')::uuid,(c->>'session')::uuid,'in_progress');
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'error'='player_in_active_hand','running hand never forced');
 UPDATE public.tournament_hands SET status='completed' WHERE tournament_id=(c->>'tour')::uuid;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
 r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'error'='actor_not_allowed','cross tenant denied');
 PERFORM set_config('request.jwt.claim.sub','',false); r:=fast_bust_test.invoke(c);
 PERFORM public.floor_table_v3_assert(r->>'error'='invalid_request','no actor denied');
 PERFORM public.floor_table_v3_assert(NOT has_function_privilege('anon','public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text)','EXECUTE'),'anon ACL');
 PERFORM public.floor_table_v3_assert(NOT has_function_privilege('service_role','public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text)','EXECUTE'),'service role ACL');
END $$;

SELECT 'FLOOR_FAST_BUST_NATIVE_CASES_PASS' AS result;

CREATE TABLE fast_bust_test.cases(name text PRIMARY KEY, context jsonb NOT NULL);
DO $$
DECLARE c jsonb; p uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
BEGIN
 c:=fast_bust_test.seed('tracker');
 INSERT INTO fast_bust_test.cases VALUES('first',c),('same',c);
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,current_stack)
 VALUES(e,(c->>'tour')::uuid,p,1,'seated',1000);
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,tournament_table_id,
 table_session_id,seat_number,chip_count,entry_id,is_active,status)
 VALUES(s,(c->>'tour')::uuid,p,1,(c->>'table')::uuid,(c->>'table')::uuid,(c->>'session')::uuid,2,1000,e,true,'active');
 INSERT INTO fast_bust_test.cases VALUES('second',c||jsonb_build_object('seat',s,'entry',e,'player',p,'number',2));
 c:=fast_bust_test.seed('tracker'); INSERT INTO fast_bust_test.cases VALUES('double',c);
END $$;
