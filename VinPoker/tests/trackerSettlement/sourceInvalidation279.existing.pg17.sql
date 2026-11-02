\set ON_ERROR_STOP on
-- Existing retained TEST proof. No fixture constructor/reseed/worker/commit.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'
  AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND source_revision=24 AND status='completed' AND NOT is_voided);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
  CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) h
  WHERE o.hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND o.status='verified'
   AND o.verification_scope='historical_display' AND o.source_revision=h.source_revision AND o.source_chain_hash=h.source_chain_hash);
END $$;
CREATE TEMP TABLE source279_before AS
 SELECT h.source_revision,s.source_chain_hash,
  (SELECT count(*) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id AND o.status='verified') verified_count,
  has_schema_privilege('authenticated','auth','USAGE') auth_usage,
  md5(jsonb_build_object(
   'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
   'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
   'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
   'proofs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
   'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
   'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
   'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
   'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x)
  )::text) fingerprint
 FROM public.tournament_hands h CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
 WHERE h.id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
-- Native auth.uid() uses the per-claim setting; never replace its definition.
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
CREATE FUNCTION pg_temp.assert_source279(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE revision bigint; chain_hash text;
BEGIN
 SELECT source_revision,source_chain_hash INTO STRICT revision,chain_hash
 FROM public.get_tournament_historical_display_source_hash('4aa376ee-4a27-4963-9c69-dd0a2cd17abf');
 ASSERT revision=(SELECT source_revision+1 FROM source279_before),label||': revision did not advance exactly once';
 ASSERT chain_hash<>(SELECT source_chain_hash FROM source279_before),label||': hash unchanged';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND status='verified'),label||': old verified proof survives';
 ASSERT (SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'
  AND source_revision=24 AND status='stale')>=(SELECT verified_count FROM source279_before),label||': proof not stale';
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf'
  AND source_revision=revision AND status='pending'),label||': new queue generation missing';
END $$;
CREATE FUNCTION pg_temp.assert_public279() RETURNS void LANGUAGE plpgsql AS $$
DECLARE page jsonb; item jsonb;
BEGIN
 page:=public.get_public_tournament_table_history_v2('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',50,NULL,NULL);
 ASSERT page->>'access'='public';
 SELECT x INTO STRICT item FROM jsonb_array_elements(page->'items') x WHERE x->>'handId'='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 ASSERT item->'result'->>'status'='pending','anonymous projection still publishes old winner';
 ASSERT NOT (item->'result' ? 'recipients'),'old public recipients survived invalidation';
END $$;
SAVEPOINT action_case;
SET LOCAL ROLE authenticated;
UPDATE public.hand_actions SET action_amount=action_amount+1
 WHERE id='4a87e786-b21d-4074-9250-85e28fbb8386' AND hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
RESET ROLE;
SELECT pg_temp.assert_source279('action amount');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_public279();
RESET ROLE;
ROLLBACK TO action_case;
\echo SOURCE279_AUTH_ACTION_REVISION_PROOF_QUEUE_ANON_PENDING_PASS
SAVEPOINT player_case;
SET LOCAL ROLE authenticated;
UPDATE public.hand_players SET ending_stack=ending_stack+1
 WHERE hand_id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND seat_number=1;
RESET ROLE;
SELECT pg_temp.assert_source279('participant ending stack');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_public279();
RESET ROLE;
ROLLBACK TO player_case;
\echo SOURCE279_AUTH_PARTICIPANT_REVISION_PROOF_QUEUE_ANON_PENDING_PASS
SAVEPOINT hand_case;
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
RESET ROLE;
SELECT pg_temp.assert_source279('hand pot');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_public279();
RESET ROLE;
ROLLBACK TO hand_case;
\echo SOURCE279_AUTH_HAND_REVISION_PROOF_QUEUE_ANON_PENDING_PASS
ROLLBACK;
DO $$ DECLARE actual text;
BEGIN
 SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  'proofs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
  'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
  'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x)
 )::text) INTO actual;
 ASSERT actual=(SELECT fingerprint FROM source279_before),'rollback changed retained data';
 ASSERT has_schema_privilege('authenticated','auth','USAGE')=(SELECT auth_usage FROM source279_before),'auth schema privilege not restored';
END $$;
\echo SOURCE279_ALL_HANDS_PLAYERS_ACTIONS_PROOFS_QUEUES_CASH_PRIZES_NOTICES_ACL_UNCHANGED_PASS
