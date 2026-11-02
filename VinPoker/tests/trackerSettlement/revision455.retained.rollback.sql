BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
CREATE FUNCTION pg_temp.facts455() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
DO $test$ DECLARE hand uuid:='31c2e710-590f-4e82-b8ff-c8e887c5b314';tour uuid:='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 table_id uuid:='8508d715-cd7c-4f1f-bb0d-223d967e355c';baseline text;revision bigint;assignment text;item jsonb;tested int:=0;
BEGIN
 baseline:=pg_temp.facts455();
 SELECT source_revision INTO STRICT revision FROM public.tournament_hands WHERE id=hand AND status='completed' AND NOT is_voided;
 ASSERT revision=15;
 SELECT value INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(tour,table_id,20,NULL,NULL)->'items') WHERE value->>'handId'=hand::text;
 ASSERT item#>>'{result,status}'='verified';
 FOREACH assignment IN ARRAY ARRAY[
  'pot_size=pot_size+1',
  'button_seat=CASE WHEN button_seat=1 THEN 2 ELSE 1 END',
  'hand_number=hand_number+100000',
  'community_cards=''[]''::jsonb',
  'side_pots=''[{"amount":1,"eligible_player_ids":[]}]''::jsonb',
  'tracker_small_blind=coalesce(tracker_small_blind,0)+1',
  'tracker_big_blind=coalesce(tracker_big_blind,0)+1',
  'tracker_bba=coalesce(tracker_bba,0)+1',
  'tracker_level_number=coalesce(tracker_level_number,0)+1',
  'tracker_is_break=NOT coalesce(tracker_is_break,false)',
  'tracker_blind_evidence=coalesce(tracker_blind_evidence,''{}''::jsonb)||''{"local_test455":true}''::jsonb'
 ] LOOP
  BEGIN
   -- Privileged fault-injection seam, not a canonical correction/actor-authority test.
   EXECUTE format('UPDATE public.tournament_hands SET %s WHERE id=$1',assignment) USING hand;
   ASSERT (SELECT source_revision>revision FROM public.tournament_hands WHERE id=hand);
   PERFORM set_config('role','anon',true);
   SELECT value INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(tour,table_id,20,NULL,NULL)->'items') WHERE value->>'handId'=hand::text;
   ASSERT item#>>'{result,status}'='pending';
   ASSERT coalesce(jsonb_array_length(item#>'{result,recipients}'),0)=0;
   PERFORM set_config('role','none',true);
   RAISE EXCEPTION USING ERRCODE='P0455',MESSAGE='rollback successful source fault';
  EXCEPTION WHEN SQLSTATE 'P0455' THEN NULL;
  END;
  ASSERT pg_temp.facts455()=baseline;
  tested:=tested+1;
 END LOOP;
 ASSERT tested=11;
 RAISE NOTICE 'REVISION455_11_NATIVE_HAND_INPUT_UPDATES_HIDE_OLD_PUBLIC_PROOF_EXACT_ROLLBACK_PASS';
END $test$;
ROLLBACK;
