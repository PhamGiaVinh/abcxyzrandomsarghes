BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba' AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND source_revision=18 AND status='in_progress' AND NOT is_voided)
 THEN RAISE EXCEPTION 'hand134_exact_retained_fixture_guard';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;probe jsonb;BEGIN
 r:=public.void_last_hand('f420f331-d986-4278-acba-dcdb7303a5ba');
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'hand134_void_rehearsal %',r;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba' AND is_voided AND source_revision>18)
 THEN RAISE EXCEPTION 'hand134_void_did_not_fence_revision';END IF;
 IF (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND is_active)<>60000
 OR NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='96ae5f01-7e6e-4344-895a-2b5cdbf124cd' AND current_stack=58600)
 OR NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='9384eec9-8014-4d38-a1b0-03a35d264aa9' AND current_stack=1400)
 THEN RAISE EXCEPTION 'hand134_void_stack_projection_mismatch';END IF;
 -- A new, explicitly synthetic test intent probes the OLD context guard.
 -- It is NOT the lost b603 payload and is never recorded as that request.
 probe:=jsonb_build_object('actor_id','675fe35e-60a8-4452-bb90-e79486d54da6','request_id',gen_random_uuid(),
  'tournament_id','46cab483-91e7-4220-aacf-e17bdf05269c','tournament_table_id','d294f4a4-082b-4efc-a6ca-1f96579ea344',
  'hand_id','f420f331-d986-4278-acba-dcdb7303a5ba','table_session_id','ee2b9393-0c96-42f9-8667-7f306edeb9bc','control_epoch',8,'source_revision',18,
  'payload',jsonb_build_object('hand_time',now(),'players',jsonb_build_array(jsonb_build_object('player_id','5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','entry_number',1,'starting_stack',58600,'ending_stack',58600)),
   'actions','[]'::jsonb,'community_cards','[]'::jsonb,'side_pots','[]'::jsonb,'pot_size',0));
 r:=public.record_tracker_manual_hand_v1(probe);
 IF r->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'hand134_old_context_not_fenced %',r;END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'HAND134_ACTUAL_VOID_REVISION_STACK_RESTORE_OLD_CONTEXT_FINISH_DENIED_ROLLBACK_PASS';
