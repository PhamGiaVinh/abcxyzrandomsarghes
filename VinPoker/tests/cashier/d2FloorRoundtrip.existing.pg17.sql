-- Exact isolated failed-journey fixture; rollback all test writes.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr()<>'127.0.0.1'::inet
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
 RAISE EXCEPTION 'isolated_d2_fixture_required';END IF;
END $$;
DO $$
DECLARE entry uuid:='44f38cd5-c8a3-424c-99e5-803b7692a71a';
 actor uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
 tour uuid:='7a5a5738-1654-4597-9b8a-597944591e41';
 src record; dest record; r jsonb; saved jsonb; req uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=tour AND event_id='9f1a9d8f-1107-49cd-9c80-d2b04bedefd4'
  AND name='Multi-day Final local TEST') THEN RAISE EXCEPTION 'exact_owned_d2_target_missing';END IF;
 IF NOT floor_private.is_qualified_final_entry_v1(entry) OR floor_private.is_qualified_final_entry_v1(gen_random_uuid())
 OR has_function_privilege('authenticated','floor_private.is_qualified_final_entry_v1(uuid)','EXECUTE')
 OR has_function_privilege('anon','floor_private.is_qualified_final_entry_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'qualification_helper_acl_or_identity_failed';END IF;
 SELECT s.id seat,s.chip_count,s.seat_number,x.revision,x.control_epoch,x.id session,t.id table_id INTO STRICT src
 FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id
 JOIN public.tournament_tables t ON t.id=s.tournament_table_id WHERE s.entry_id=entry AND s.is_active;
 SELECT t.id table_id,x.id session,x.revision INTO STRICT dest FROM public.tournament_tables t
 JOIN public.table_sessions x ON x.id=t.table_session_id WHERE t.tournament_id=tour AND t.id<>src.table_id
 AND x.closed_at IS NULL ORDER BY t.table_number LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 r:=public.floor_free_sit_player_v1(entry,src.revision,src.control_epoch,src.chip_count,gen_random_uuid(),'TEST denied');
 IF r->>'error'<>'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_must_fail: %',r;END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_free_sit_player_v1(entry,src.revision-1,src.control_epoch,src.chip_count,gen_random_uuid(),'TEST stale');
 IF r->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'stale_free_sit_accepted: %',r;END IF;
 r:=public.floor_free_sit_player_v1(entry,src.revision,src.control_epoch,src.chip_count,req,'TEST D2 roundtrip');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'qualified_free_sit_failed: %',r;END IF;
 saved:=r;
 IF public.floor_free_sit_player_v1(entry,src.revision,src.control_epoch,src.chip_count,req,'TEST D2 roundtrip')<>saved THEN
  RAISE EXCEPTION 'free_sit_replay_failed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_floor_seatable_entries(tour) e WHERE e.entry_id=entry) THEN
  RAISE EXCEPTION 'qualified_waiting_entry_hidden';END IF;
 req:=gen_random_uuid();
 r:=public.floor_assign_entry_to_seat_v4(entry,dest.table_id,10,dest.revision,gen_random_uuid());
 IF r->>'error' IS DISTINCT FROM 'invalid_seat_number' THEN RAISE EXCEPTION 'invalid_capacity_accepted: %',r;END IF;
 r:=public.floor_assign_entry_to_seat_v4(entry,dest.table_id,1,dest.revision,req);
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'qualified_reseat_failed: %',r;END IF;
 IF (r->>'seat_id')::uuid<>src.seat THEN RAISE EXCEPTION 'canonical_seat_identity_changed';END IF;
 IF public.floor_assign_entry_to_seat_v4(entry,dest.table_id,1,dest.revision,req)<>r THEN RAISE EXCEPTION 'reseat_replay_failed';END IF;
 saved:=public.floor_assign_entry_to_seat_v4(entry,dest.table_id,2,dest.revision,req);
 IF saved->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'reseat_changed_payload_accepted: %',saved;END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id=entry AND current_stack=src.chip_count AND status='seated'
  AND registration_id IS NULL AND seat_id=src.seat) THEN RAISE EXCEPTION 'reseat_entry_projection_lost: %',(SELECT to_jsonb(e) FROM public.tournament_entries e WHERE e.id=entry);END IF;
 IF (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry AND is_active)<>1 THEN RAISE EXCEPTION 'double_seat';END IF;
 IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=tour) THEN RAISE EXCEPTION 'D2_second_buyin';END IF;
END $$;
ROLLBACK;
SELECT 'QUALIFIED_D2_FREE_SIT_WAIT_RESEAT_OTHER_SESSION_REPLAY_NO_BUYIN_ROLLBACK_PASS';
