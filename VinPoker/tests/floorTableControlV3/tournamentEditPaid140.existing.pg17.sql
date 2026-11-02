-- Existing paid main journey, canonical201 edit, rollback-only boundary test.
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND source_revision=24 AND status='completed' AND NOT is_voided)
 OR (SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c') IS DISTINCT FROM 300000
 THEN RAISE EXCEPTION 'edit_paid140_exact_local_journey';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $test$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';hand uuid:='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 c jsonb;cfg jsonb;r jsonb;before_facts jsonb;after_facts jsonb;before_hash jsonb;display_hash text;
BEGIN
 SELECT jsonb_build_object('registrations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x WHERE tournament_id=tour),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id=tour),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id=tour),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id=tour),
  'levels',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_levels x WHERE tournament_id=tour),
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x WHERE tournament_id=tour),
  'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id=hand)) INTO before_facts;
 SELECT to_jsonb(s) INTO before_hash FROM public.get_tournament_settlement_source_hash(hand) s;
 display_hash:=public.get_tracker_historical_display_snapshot(hand,tour)->>'sourceChainHash';
 PERFORM set_config('role','authenticated',true);
 c:=public.get_tournament_edit_context_v1(tour,auth.uid());
 IF c->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'edit_paid140_context %',c;END IF;
 cfg:=c#>'{state,config}';
 cfg:=cfg||jsonb_build_object('buy_in',(cfg->>'buy_in')::bigint+1,'rake_amount',(cfg->>'rake_amount')::bigint+1,
  'service_fee_amount',(cfg->>'service_fee_amount')::bigint+1,'starting_stack',(cfg->>'starting_stack')::bigint+1);
 r:=public.edit_tournament_with_levels_v1(tour,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',c->'state',cfg,NULL,gen_random_uuid(),auth.uid());
 IF r->>'ok' IS DISTINCT FROM 'true' OR r#>'{state,config}' IS DISTINCT FROM cfg THEN RAISE EXCEPTION 'edit_paid140_canonical_config %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('registrations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x WHERE tournament_id=tour),
  'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id=tour),
  'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id=tour),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id=tour),
  'levels',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_levels x WHERE tournament_id=tour),
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x WHERE tournament_id=tour),
  'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id=hand)) INTO after_facts;
 IF after_facts IS DISTINCT FROM before_facts OR (SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash(hand) s) IS DISTINCT FROM before_hash
 OR public.get_tracker_historical_display_snapshot(hand,tour)->>'sourceChainHash' IS DISTINCT FROM display_hash
 THEN RAISE EXCEPTION 'edit_paid140_repriced_existing_facts_or_invalidated_frozen_hand';END IF;
END $test$;
ROLLBACK;
SELECT 'EDIT_PAID140_CANONICAL_CONFIG_PRESERVES_EXISTING_PRICES_STACKS_CASH_LEVELS_PROOFS_ROLLBACK_PASS';
