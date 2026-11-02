\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
 OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'payout375_local_only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  WHERE t.id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND t.name='Cash identity local TEST'
   AND t.club_id='7f3c6f90-3667-4c8c-9a00-6f00da680d84' AND c.owner_id='40b8f243-bf3b-4aaa-962b-db788380207c'
   AND t.event_id IS NULL AND t.registration_closed_at IS NULL AND t.live_status IS DISTINCT FROM 'finished')
 OR EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08')
 THEN RAISE EXCEPTION 'payout375_retained_fixture_drift'; END IF;
END $$;
SELECT set_config('vinpoker.payout375_before',(SELECT md5(jsonb_build_object(
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prizes p WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'))::text)),true);
SAVEPOINT before_prepare;
SELECT set_config('request.jwt.claim.sub','40b8f243-bf3b-4aaa-962b-db788380207c',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE response jsonb; BEGIN
 response:=public.prepare_payout_snapshot(p_tournament_id=>'6a7fb4a3-8b46-44be-a71a-ca12a052ee08',
  p_itm_percent=>0.2,p_archetype=>'DAILY',p_min_cash_x=>2,p_rounding_unit=>100000);
 IF response->>'status' IS DISTINCT FROM 'prepared' OR response->>'run_id' IS NULL THEN
  RAISE EXCEPTION 'payout375_prepare_denied: %',response; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND registration_closed_at IS NOT NULL)
 OR (SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND status='draft_snapshot')<>1
 OR EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND status='applied')
 THEN RAISE EXCEPTION 'payout375_prepare_boundary_not_observed'; END IF;
END $$;
SELECT 'PAYOUT375_REGISTRATION_CLOSED_DRAFT_PRESENT_BEFORE_ANY_COMPUTE';
ROLLBACK TO before_prepare;
DO $$ DECLARE after_hash text; BEGIN
 SELECT md5(jsonb_build_object(
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prizes p WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'))::text) INTO after_hash;
 IF after_hash IS DISTINCT FROM current_setting('vinpoker.payout375_before')
 OR EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08')
 THEN RAISE EXCEPTION 'payout375_rollback_not_exact'; END IF;
END $$;
SELECT 'PAYOUT375_ALL_RETAINED_FACTS_UNCHANGED';
ROLLBACK;
