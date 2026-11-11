-- Runtime contract for migrations 00019 + 00022. Run only in the PG17
-- disposable workflow after their exact prerequisite migrations.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,is_break)
VALUES
 ('11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',2,100,200,25,false),
 ('11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',1,50,100,10,false);
INSERT INTO public.tournaments(id,club_id,current_level,status) VALUES
 ('10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001',1,'live');
INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_name) VALUES
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','foreign tournament');

-- Insert completion-queue candidates; uniqueness is per hand and source revision.
INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,
  button_seat,community_cards,pot_size,tracker_small_blind,tracker_big_blind,tracker_level_number,tracker_bba,
  status,source_revision,created_at)
VALUES
 ('61000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',41,1,'[]',100,50,100,1,10,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',42,1,'[]',100,50,100,1,10,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',43,1,'[]',100,50,100,1,10,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',44,1,'[]',100,50,100,1,10,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',45,1,'[]',100,NULL,NULL,NULL,NULL,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',46,1,'[]',100,50,100,1,10,'completed',1,now()),
 ('61000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',47,1,'[]',100,50,100,1,10,'completed',1,now());

DO $$
DECLARE v_id uuid := '61000000-0000-4000-8000-000000000011'; v_rev bigint; v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.tracker_historical_display_queue WHERE hand_id=v_id AND source_revision=1;
  IF v_count <> 1 THEN RAISE EXCEPTION 'insert must enqueue exactly once, found %',v_count; END IF;
  PERFORM public.tracker_enqueue_historical_display(v_id);
  SELECT count(*) INTO v_count FROM public.tracker_historical_display_queue WHERE hand_id=v_id AND source_revision=1;
  IF v_count <> 1 THEN RAISE EXCEPTION 'enqueue replay duplicated a hand/revision'; END IF;
  UPDATE public.tournament_hands SET community_cards='["AS"]' WHERE id=v_id;
  SELECT source_revision INTO v_rev FROM public.tournament_hands WHERE id=v_id;
  IF v_rev <> 2 OR (SELECT status FROM public.tracker_historical_display_queue WHERE hand_id=v_id AND source_revision=1) <> 'cancelled'
    OR (SELECT status FROM public.tracker_historical_display_queue WHERE hand_id=v_id AND source_revision=2) <> 'pending' THEN
    RAISE EXCEPTION 'revision update did not cancel stale and enqueue current revision';
  END IF;
  UPDATE public.tournament_hands SET is_voided=true WHERE id=v_id;
  IF (SELECT status FROM public.tracker_historical_display_queue WHERE hand_id=v_id AND source_revision=2) <> 'cancelled' THEN
    RAISE EXCEPTION 'void did not cancel pending proof';
  END IF;
  BEGIN PERFORM * FROM public.claim_tracker_historical_display_jobs(51); RAISE EXCEPTION 'batch limit accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

-- Bounded batch and lease fencing.
DO $$
DECLARE v_claim record; v_old uuid; v_new uuid; v_rev bigint; v_id uuid;
BEGIN
  UPDATE public.tracker_historical_display_queue SET next_attempt_at=now()+interval '1 day'
    WHERE hand_id <> '61000000-0000-4000-8000-000000000012' AND status='pending';
  SELECT * INTO v_claim FROM public.claim_tracker_historical_display_jobs(1) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'second ready hand was not claimable'; END IF;
  v_id := v_claim.hand_id; v_rev := v_claim.source_revision; v_old := v_claim.lease_token;
  IF v_id <> '61000000-0000-4000-8000-000000000012' THEN RAISE EXCEPTION 'batch bound selected unexpected hand: %',v_id; END IF;
  UPDATE public.tracker_historical_display_queue SET lease_until=now()-interval '1 second'
    WHERE hand_id=v_id AND source_revision=v_rev;
  SELECT lease_token INTO v_new FROM public.claim_tracker_historical_display_jobs(1)
    WHERE hand_id=v_id AND source_revision=v_rev;
  IF v_new IS NULL OR v_new=v_old THEN RAISE EXCEPTION 'expired lease was not fenced with a new token'; END IF;
  IF public.finish_tracker_historical_display_job(v_id,v_rev,v_old,'completed') THEN
    RAISE EXCEPTION 'stale lease token completed a reclaimed job';
  END IF;
  BEGIN
    PERFORM public.commit_tracker_historical_display_outcome_v2(
      v_id,'00000000-0000-4000-8000-000000000001','system_worker',v_rev,repeat('a',64),
      repeat('b',64),repeat('c',64),'stale-worker-key-0001','{}'::jsonb,v_old);
    RAISE EXCEPTION 'stale worker lease committed historical proof';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  IF NOT public.finish_tracker_historical_display_job(v_id,v_rev,v_new,'pending','retry-test') THEN
    RAISE EXCEPTION 'current lease token failed CAS';
  END IF;
  UPDATE public.tracker_historical_display_queue SET next_attempt_at=now()
    WHERE status='pending';
END $$;

-- True two-connection SKIP LOCKED proof: lock the oldest pending job remotely,
-- then the local claim must take a different hand without waiting.
UPDATE public.tracker_historical_display_queue
SET next_attempt_at=now()+interval '1 day'
WHERE status='pending';
UPDATE public.tracker_historical_display_queue
SET next_attempt_at=now(), enqueued_at=CASE hand_id
  WHEN '61000000-0000-4000-8000-000000000013'::uuid THEN now()-interval '2 seconds'
  ELSE now()-interval '1 second' END
WHERE status='pending'
  AND hand_id IN (
    '61000000-0000-4000-8000-000000000013'::uuid,
    '61000000-0000-4000-8000-000000000014'::uuid
  );
SELECT dblink_connect('queue_lock', 'dbname=' || current_database());
SELECT dblink_exec('queue_lock', 'BEGIN');
SELECT * FROM dblink('queue_lock', $$SELECT 1 FROM public.tracker_historical_display_queue
  WHERE hand_id='61000000-0000-4000-8000-000000000013' AND source_revision=1 FOR UPDATE$$) AS locked(id integer);
DO $$ DECLARE v record; BEGIN
  SELECT * INTO v FROM public.claim_tracker_historical_display_jobs(1) LIMIT 1;
  IF NOT FOUND OR v.hand_id<>'61000000-0000-4000-8000-000000000014' THEN
    RAISE EXCEPTION 'claim did not skip locked priority hand 13 for ready hand 14: %',v.hand_id;
  END IF;
END $$;
SELECT dblink_exec('queue_lock','ROLLBACK');
SELECT dblink_disconnect('queue_lock');

-- Owner correction fills missing values, bumps source revision, audits once,
-- enqueues current proof; retry is idempotent, mismatch and foreign level fail.
DO $$
DECLARE v jsonb; v_before bigint; v_after bigint; v_audit int;
BEGIN
  SELECT source_revision INTO v_before FROM public.tournament_hands WHERE id='61000000-0000-4000-8000-000000000015';
  v := public.correct_tracker_historical_hand_blinds(
    '61000000-0000-4000-8000-000000000015','80000000-0000-4000-8000-000000000001',v_before,
    '11000000-0000-4000-8000-000000000002',2,100,200,25,'recover recorded history','blind-fix-key-0001','{"source":"fixture"}');
  IF v->>'ok' <> 'true' OR v->>'idempotent' <> 'false' THEN RAISE EXCEPTION 'correction failed: %',v; END IF;
  SELECT source_revision INTO v_after FROM public.tournament_hands WHERE id='61000000-0000-4000-8000-000000000015';
  IF v_after <> v_before+1 OR (SELECT tracker_big_blind FROM public.tournament_hands WHERE id='61000000-0000-4000-8000-000000000015') <> 200 THEN
    RAISE EXCEPTION 'correction did not fill snapshot and bump revision';
  END IF;
  SELECT count(*) INTO v_audit FROM public.tracker_hand_blind_correction_audit WHERE hand_id='61000000-0000-4000-8000-000000000015';
  IF v_audit <> 1 OR NOT EXISTS (SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='61000000-0000-4000-8000-000000000015' AND source_revision=v_after AND status='pending') THEN
    RAISE EXCEPTION 'correction audit or new proof queue missing';
  END IF;
  v := public.correct_tracker_historical_hand_blinds(
    '61000000-0000-4000-8000-000000000015','80000000-0000-4000-8000-000000000001',v_before,
    '11000000-0000-4000-8000-000000000002',2,100,200,25,'recover recorded history','blind-fix-key-0001','{"source":"fixture"}');
  IF v->>'idempotent' <> 'true' THEN RAISE EXCEPTION 'correction replay not idempotent'; END IF;
  BEGIN
    PERFORM public.correct_tracker_historical_hand_blinds(
      '61000000-0000-4000-8000-000000000015','80000000-0000-4000-8000-000000000001',v_before,
      '11000000-0000-4000-8000-000000000002',2,100,200,25,'different reason text','blind-fix-key-0001','{"source":"fixture"}');
    RAISE EXCEPTION 'idempotency mismatch accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.correct_tracker_historical_hand_blinds(
      '61000000-0000-4000-8000-000000000016','80000000-0000-4000-8000-000000000001',1,
      '11000000-0000-4000-8000-000000000003',1,50,100,10,'foreign level test','blind-fix-key-0002','{"source":"fixture"}');
    RAISE EXCEPTION 'foreign-tournament level accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

-- The single-statement snapshot sees one committed source generation while an
-- independent transaction changes both player and action rows, then sees the
-- complete new generation after commit. It must never combine old/new rows.
INSERT INTO public.hand_players(id,hand_id,tournament_id,player_id,entry_number,seat_number,player_name,starting_stack,ending_stack,hole_cards)
VALUES ('71000000-0000-4000-8000-000000000016','61000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,1,'Snapshot',1000,1000,'[]');
INSERT INTO public.hand_actions(id,hand_id,player_id,entry_number,action_type,action_amount,action_order,street)
VALUES ('72000000-0000-4000-8000-000000000016','61000000-0000-4000-8000-000000000016','50000000-0000-4000-8000-000000000001',1,'bet',10,1,'preflop');
SELECT dblink_connect('snapshot_writer','dbname='||current_database()||' user='||current_user);
SELECT dblink_exec('snapshot_writer','SET request.jwt.claims = ''{"role":"service_role"}''');
SELECT dblink_exec('snapshot_writer','BEGIN');
SELECT dblink_exec('snapshot_writer',$remote$
  UPDATE public.hand_players SET ending_stack=2000
  WHERE id='71000000-0000-4000-8000-000000000016'::uuid;
  UPDATE public.hand_actions SET action_amount=20
  WHERE id='72000000-0000-4000-8000-000000000016'::uuid
$remote$);
SELECT dblink_connect('snapshot_reader','dbname='||current_database()||' user='||current_user);
SELECT dblink_send_query('snapshot_reader',$remote$
  SELECT public.get_tracker_historical_display_snapshot(
    '61000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000001')
  FROM (SELECT pg_sleep(0.3)) AS statement_barrier
$remote$);
SELECT pg_sleep(0.1);
DO $$ BEGIN
  IF dblink_is_busy('snapshot_reader') <> 1 THEN
    RAISE EXCEPTION 'snapshot reader completed before concurrent commit barrier';
  END IF;
END $$;
SELECT dblink_exec('snapshot_writer','COMMIT');
DO $$ DECLARE v jsonb; BEGIN
  SELECT result INTO v FROM dblink_get_result('snapshot_reader') AS r(result jsonb);
  IF (v #>> '{players,0,ending_stack}')::numeric <> 1000
    OR (v #>> '{actions,0,action_amount}')::numeric <> 10 THEN
    RAISE EXCEPTION 'snapshot mixed generations across a concurrent commit: %',v;
  END IF;
END $$;
SELECT dblink_disconnect('snapshot_reader');
DO $$ DECLARE v jsonb; BEGIN
  v := public.get_tracker_historical_display_snapshot(
    '61000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000001');
  IF (v #>> '{players,0,ending_stack}')::numeric <> 2000
    OR (v #>> '{actions,0,action_amount}')::numeric <> 20 THEN
    RAISE EXCEPTION 'snapshot did not publish the complete committed generation: %',v;
  END IF;
END $$;
SELECT dblink_disconnect('snapshot_writer');

-- Conflicting stored blind values are preserved; the review queue is marked.
UPDATE public.tournament_hands SET tracker_small_blind=75
WHERE id='61000000-0000-4000-8000-000000000017';
DO $$ DECLARE v jsonb; BEGIN
  v := public.correct_tracker_historical_hand_blinds(
    '61000000-0000-4000-8000-000000000017','80000000-0000-4000-8000-000000000001',2,
    '11000000-0000-4000-8000-000000000002',2,100,200,25,'preserve conflicting value','blind-fix-key-0003','{"source":"fixture"}');
  IF v->>'status' <> 'needs_attention' OR (SELECT tracker_small_blind FROM public.tournament_hands WHERE id='61000000-0000-4000-8000-000000000017') <> 75
    OR (SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='61000000-0000-4000-8000-000000000017' AND source_revision=2) <> 'needs_attention' THEN
    RAISE EXCEPTION 'conflicting stored blind was changed or not flagged: %',v;
  END IF;
END $$;

-- Public history proof uses exact historical_display revision+hash. A chain
-- outcome with the same revision/hash must not satisfy a missing display proof.
DO $$
DECLARE v_hash text; v_rev bigint; v_page jsonb;
  v_public jsonb := '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":100,"netDelta":0}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":100}]}],"refunds":[]}'::jsonb;
BEGIN
  INSERT INTO public.hand_players(id,hand_id,tournament_id,player_id,entry_number,seat_number,player_name,starting_stack,ending_stack,hole_cards)
  VALUES ('71000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,1,'Public',1000,1000,'[]');
  SELECT source_chain_hash,source_revision INTO v_hash,v_rev FROM public.get_tournament_historical_display_source_hash('61000000-0000-4000-8000-000000000012');
  INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,source_revision,source_chain_hash,settlement_revision,
    outcome_hash,rule_version,status,public_outcome,request_hash,idempotency_key,actor_user_id,verification_scope,actor_kind)
  VALUES ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000012',v_rev,v_hash,1,repeat('a',64),
    'fixture','verified',v_public,repeat('b',64),'history-chain-only-0001','80000000-0000-4000-8000-000000000001','chain','owner_admin');
END $$;
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false);
DO $$
DECLARE v_page jsonb;
BEGIN
  v_page := public.get_public_tournament_table_history_v2('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',50,NULL,NULL);
  IF jsonb_path_query_first(v_page,'$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000012").result.status') #>> '{}' <> 'pending' THEN
    RAISE EXCEPTION 'chain proof incorrectly satisfied public historical display';
  END IF;
END $$;
RESET ROLE;

-- Two independent PostgreSQL sessions race the same owner/admin commit and
-- idempotency key. Row locking plus replay must leave one settlement revision.
INSERT INTO public.hand_players(id,hand_id,tournament_id,player_id,entry_number,seat_number,player_name,starting_stack,ending_stack,hole_cards)
VALUES ('71000000-0000-4000-8000-000000000014','61000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,1,'Race',1000,1000,'[]');
DO $$
DECLARE v_hash text; v_rev bigint; v_sql text; v_outcome jsonb;
  v_one jsonb; v_two jsonb; v_sent int;
BEGIN
  SELECT source_chain_hash,source_revision INTO v_hash,v_rev FROM public.get_tournament_historical_display_source_hash('61000000-0000-4000-8000-000000000014');
  v_outcome := jsonb_build_object(
    'schemaVersion','settlement-outcome-v1','status','verified','sourceRevision',v_rev,
    'sourceChainHash',v_hash,'settlementRevision',1,'outcomeHash',repeat('f',64),
    'ruleVersion','clockwise-first-eligible-winner-left-of-button/v1',
    'players',jsonb_build_array(jsonb_build_object('playerId','50000000-0000-4000-8000-000000000001',
      'startingStack',1000,'committedTotal',0,'potAward',0,'refund',0,'creditedTotal',0,
      'netDelta',0,'externalDelta',0,'endingStack',1000)),
    'pots','[]'::jsonb,'refunds','[]'::jsonb,'handRanks','[]'::jsonb,'totals','{}'::jsonb);
  v_sql := format('SELECT public.commit_tracker_historical_display_outcome_v2(%L::uuid,%L::uuid,%L::text,%L::bigint,%L::text,%L::text,%L::text,%L::text,%L::jsonb,NULL)',
    '61000000-0000-4000-8000-000000000014','80000000-0000-4000-8000-000000000001','owner_admin',v_rev,v_hash,repeat('f',64),repeat('a',64),'concurrent-same-hand-key-0001',v_outcome::text);
  PERFORM dblink_connect('commit_one','dbname='||current_database()||' user='||current_user);
  PERFORM dblink_connect('commit_two','dbname='||current_database()||' user='||current_user);
  PERFORM dblink_exec('commit_one', 'SET request.jwt.claims = ''{"role":"service_role"}''');
  PERFORM dblink_exec('commit_two', 'SET request.jwt.claims = ''{"role":"service_role"}''');
  PERFORM dblink_exec('commit_one','BEGIN');
  PERFORM * FROM dblink('commit_one',
    'SELECT 1 FROM public.tournament_hands WHERE id=''61000000-0000-4000-8000-000000000014''::uuid FOR UPDATE')
    AS locked(id integer);
  v_sent := dblink_send_query('commit_two',v_sql); IF v_sent <> 1 THEN RAISE EXCEPTION 'second concurrent commit did not start'; END IF;
  PERFORM pg_sleep(0.1);
  IF dblink_is_busy('commit_two') <> 1 THEN
    RAISE EXCEPTION 'competing same-hand commit did not wait behind the observed hand lock';
  END IF;
  SELECT result INTO v_one FROM dblink('commit_one',v_sql) AS r(result jsonb);
  PERFORM dblink_exec('commit_one','COMMIT');
  SELECT result INTO v_two FROM dblink_get_result('commit_two') AS r(result jsonb);
  PERFORM * FROM dblink_get_result('commit_two') AS r(result jsonb);
  PERFORM dblink_disconnect('commit_one'); PERFORM dblink_disconnect('commit_two');
  IF v_one->>'ok' <> 'true' OR v_two->>'ok' <> 'true'
    OR (SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='61000000-0000-4000-8000-000000000014') <> 1
    OR (SELECT max(settlement_revision) FROM public.tournament_settlement_outcomes WHERE hand_id='61000000-0000-4000-8000-000000000014') <> 1 THEN
    RAISE EXCEPTION 'concurrent same-hand commits created duplicate revision: % / %',v_one,v_two;
  END IF;
END $$;

-- A verified historical_display result is public only for the current target
-- snapshot. Updating source data changes revision+hash and returns the hand to
-- pending; it does not reuse a result whose proof was tied to the old snapshot.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
DO $$
DECLARE v_hash text; v_rev bigint; v_page jsonb;
  v_public jsonb := '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":100,"netDelta":0}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":100}]}],"refunds":[]}'::jsonb;
BEGIN
  SELECT source_chain_hash,source_revision INTO v_hash,v_rev FROM public.get_tournament_historical_display_source_hash('61000000-0000-4000-8000-000000000012');
  INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,source_revision,source_chain_hash,settlement_revision,
    outcome_hash,rule_version,status,public_outcome,request_hash,idempotency_key,actor_user_id,verification_scope,actor_kind)
  VALUES ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000012',v_rev,v_hash,2,repeat('d',64),
    'fixture','verified',v_public,repeat('e',64),'history-display-proof-0001','80000000-0000-4000-8000-000000000001','historical_display','owner_admin');
END $$;
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false);
DO $$ DECLARE v_page jsonb; BEGIN
  v_page := public.get_public_tournament_table_history_v2('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',50,NULL,NULL);
  IF jsonb_path_query_first(v_page,'$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000012").result.status') #>> '{}' <> 'verified' THEN
    RAISE EXCEPTION 'current matching historical display proof not exposed: %',v_page;
  END IF;
END $$;
RESET ROLE;
UPDATE public.hand_players SET ending_stack=999 WHERE id='71000000-0000-4000-8000-000000000011';
DO $$ DECLARE v_hash text; v_snapshot jsonb; BEGIN
  SELECT source_chain_hash INTO v_hash FROM public.get_tournament_historical_display_source_hash('61000000-0000-4000-8000-000000000012');
  v_snapshot := public.get_tracker_historical_display_snapshot('61000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001');
  IF v_snapshot->>'sourceChainHash' IS NULL OR v_snapshot->>'sourceChainHash'<>v_hash THEN
    RAISE EXCEPTION 'atomic source snapshot did not reflect the post-update historical hash';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='61000000-0000-4000-8000-000000000012'
      AND verification_scope='historical_display' AND status='verified' AND source_chain_hash=v_hash) THEN
    RAISE EXCEPTION 'source mutation retained a current historical display proof';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='61000000-0000-4000-8000-000000000012'
      AND source_revision=(SELECT source_revision FROM public.tournament_hands WHERE id='61000000-0000-4000-8000-000000000012')
      AND status='pending') THEN
    RAISE EXCEPTION 'source mutation did not enqueue the new proof revision';
  END IF;
END $$;
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false);
DO $$ DECLARE v_page jsonb; BEGIN
  v_page := public.get_public_tournament_table_history_v2('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',50,NULL,NULL);
  IF jsonb_path_query_first(v_page,'$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000012").result.status') #>> '{}' <> 'pending' THEN
    RAISE EXCEPTION 'public history served stale source proof after source change';
  END IF;
END $$;
RESET ROLE;
