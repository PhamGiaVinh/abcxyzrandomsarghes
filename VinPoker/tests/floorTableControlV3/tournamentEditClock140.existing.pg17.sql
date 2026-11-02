BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=24 AND status='completed' AND NOT is_voided)
 THEN RAISE EXCEPTION 'edit_clock140_exact_local_journey';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $test$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';hand uuid:='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 before_clock jsonb;after_clock jsonb;before_hash jsonb;display_hash text;c jsonb;levels jsonb;r jsonb;k text;
BEGIN
 SELECT to_jsonb(s) INTO before_hash FROM public.get_tournament_settlement_source_hash(hand) s;
 display_hash:=public.get_tracker_historical_display_snapshot(hand,tour)->>'sourceChainHash';
 PERFORM set_config('role','authenticated',true);
 before_clock:=public.get_tournament_clock(tour);
 IF before_clock->>'status'<>'live' OR before_clock->>'is_running'<>'false'
 OR before_clock#>>'{current_level,small_blind}'<>'100' OR before_clock#>>'{current_level,big_blind}'<>'200'
 THEN RAISE EXCEPTION 'edit_clock140_paused_live_clock_guard %',before_clock;END IF;
 c:=public.get_tournament_edit_context_v1(tour,auth.uid());
 SELECT jsonb_agg(jsonb_build_object('level_number',l->'level_number','small_blind',CASE WHEN (l->>'level_number')::integer=1 THEN 150 ELSE (l->>'small_blind')::integer END,
  'big_blind',CASE WHEN (l->>'level_number')::integer=1 THEN 300 ELSE (l->>'big_blind')::integer END,'ante',l->'ante','duration_minutes',l->'duration_minutes','is_break',l->'is_break') ORDER BY (l->>'level_number')::integer)
 INTO levels FROM jsonb_array_elements(c#>'{state,levels}') l;
 r:=public.edit_tournament_with_levels_v1(tour,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',c->'state',c#>'{state,config}',levels,gen_random_uuid(),auth.uid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'edit_clock140_replace %',r;END IF;
 after_clock:=public.get_tournament_clock(tour);
 FOREACH k IN ARRAY ARRAY['status','is_running','clock_paused_at','elapsed_seconds','remaining_seconds'] LOOP
  IF after_clock->k IS DISTINCT FROM before_clock->k THEN RAISE EXCEPTION 'edit_clock140_position_changed_% before=% after=%',k,before_clock,after_clock;END IF;
 END LOOP;
 IF after_clock#>>'{current_level,level_number}' IS DISTINCT FROM before_clock#>>'{current_level,level_number}'
 OR after_clock#>>'{current_level,small_blind}' IS DISTINCT FROM '150' OR after_clock#>>'{current_level,big_blind}' IS DISTINCT FROM '300'
 THEN RAISE EXCEPTION 'edit_clock140_missing_current_level before=% after=%',before_clock,after_clock;END IF;
 -- Both live local clock RPC definitions hash only level number and timing fields.
 -- Replacing blind values without changing timing must preserve that control token;
 -- it is not the tournament edit CAS snapshot or a blind-data version.
 IF after_clock->>'control_revision' IS DISTINCT FROM before_clock->>'control_revision'
 THEN RAISE EXCEPTION 'edit_clock140_timing_token_changed before=% after=%',before_clock,after_clock;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash(hand) s) IS DISTINCT FROM before_hash
 OR public.get_tracker_historical_display_snapshot(hand,tour)->>'sourceChainHash' IS DISTINCT FROM display_hash
 THEN RAISE EXCEPTION 'edit_clock140_retroactively_changed_frozen_hand';END IF;
END $test$;
ROLLBACK;
SELECT 'EDIT_CLOCK140_LEVEL_REPLACE_PRESERVES_PAUSED_POSITION_TIMING_TOKEN_NEW_BLINDS_FROZEN_HAND_PASS';
