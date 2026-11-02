-- Existing open diagnostic D2 fixture; every write/receipt/permission rolls back.
BEGIN;
SET LOCAL statement_timeout='15s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE target uuid:='44f38cd5-c8a3-424c-99e5-803b7692a71a';
 actor uuid:='62ead6ed-2bef-45ca-92ee-ed963baa1018';
 tour uuid:='7a5a5738-1654-4597-9b8a-597944591e41';
 src record; result jsonb; replay jsonb; request uuid:=gen_random_uuid(); rev bigint;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR inet_server_addr()<>'127.0.0.1'::inet OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
  RAISE EXCEPTION 'isolated_d2_database_required';END IF;
 IF NOT floor_private.is_qualified_final_entry_v1(target) OR NOT EXISTS(SELECT 1 FROM public.tournaments
  WHERE id=tour AND event_id='9f1a9d8f-1107-49cd-9c80-d2b04bedefd4' AND status='live') THEN
  RAISE EXCEPTION 'exact_open_qualified_d2_required';END IF;
 SELECT s.id seat,s.chip_count,s.seat_number,s.tournament_table_id tab,x.id session,x.revision,x.control_epoch
 INTO STRICT src FROM public.tournament_seats s JOIN public.table_sessions x ON x.id=s.table_session_id
 WHERE s.entry_id=target AND s.is_active AND x.closed_at IS NULL AND x.control_mode='manual';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_bust_player_v3(target,src.revision,src.control_epoch,src.chip_count,gen_random_uuid(),'TEST D2 mistaken bust rollback');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'D2_BUST_PREREQUISITE_FAILED: %',result;END IF;
 IF current_setting('vinpoker.restore_writer_probe',true) IS DISTINCT FROM 'on' AND NOT EXISTS(
  SELECT 1 FROM public.get_floor_restorable_entries_v3(tour) r WHERE r.entry_id=target AND r.current_stack=src.chip_count
 ) THEN RAISE EXCEPTION 'QUALIFIED_D2_MISTAKEN_BUST_HIDDEN';END IF;
 rev:=(result->>'revision')::bigint;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev,src.control_epoch,gen_random_uuid(),src.session);
 IF replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'RESTORE_OUTSIDER_ALLOWED: %',replay;END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,10,rev,src.control_epoch,gen_random_uuid(),src.session);
 IF replay->>'error' IS DISTINCT FROM 'invalid_seat_number' THEN RAISE EXCEPTION 'RESTORE_CAPACITY_ALLOWED: %',replay;END IF;
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev-1,src.control_epoch,gen_random_uuid(),src.session);
 IF replay->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'RESTORE_STALE_REVISION_ALLOWED: %',replay;END IF;
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev,src.control_epoch+1,gen_random_uuid(),src.session);
 IF replay->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'RESTORE_STALE_EPOCH_ALLOWED: %',replay;END IF;
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev,src.control_epoch,gen_random_uuid(),gen_random_uuid());
 IF replay->>'error' IS DISTINCT FROM 'table_session_mismatch' THEN RAISE EXCEPTION 'RESTORE_WRONG_SESSION_ALLOWED: %',replay;END IF;
 result:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev,src.control_epoch,request,src.session);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'QUALIFIED_D2_RESTORE_FAILED: %',result;END IF;
 IF (result->>'seat_id')::uuid<>src.seat THEN RAISE EXCEPTION 'QUALIFIED_D2_SEED_SEAT_REPLACED: %',result;END IF;
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number,rev,src.control_epoch,request,src.session);
 IF replay<>result THEN RAISE EXCEPTION 'RESTORE_RECEIPT_REPLAY_CHANGED';END IF;
 replay:=public.floor_restore_busted_player_to_seat_v5(target,src.tab,src.seat_number+1,rev,src.control_epoch,request,src.session);
 IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'RESTORE_PAYLOAD_CONFLICT_MISSING: %',replay;END IF;
 -- Legacy wrapper shares the corrected writer, without creating another seed.
 rev:=(result->>'revision')::bigint;
 result:=public.floor_bust_player_v3(target,rev,src.control_epoch,src.chip_count,gen_random_uuid(),'TEST second mistaken bust rollback');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SECOND_BUST_FAILED: %',result;END IF;
 result:=public.floor_restore_busted_player_to_seat_v3(target,src.tab,src.seat_number,(result->>'revision')::bigint,src.control_epoch,gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'seat_id')::uuid<>src.seat THEN RAISE EXCEPTION 'LEGACY_RESTORE_CHANGED_SEED: %',result;END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.id=target AND e.status='seated'
   AND e.seat_id=src.seat AND e.current_stack=src.chip_count AND e.bust_order IS NULL AND e.registration_id IS NULL)
 OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=target)<>1
 OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=tour) THEN
  RAISE EXCEPTION 'D2_RESTORE_IDENTITY_CHIP_CASH_CHANGED';END IF;
END $$;
ROLLBACK;
SELECT 'D2_RESTORE_READER_SEED_SEAT_STACK_REPLAY_NO_BUYIN_ROLLBACK_PASS';
