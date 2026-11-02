-- Exact local mutable-projection compensation. Default rehearsal/ROLLBACK.
-- Never a production migration, broad backfill, or history/receipt rewrite.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $repair$
DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 previous_hand uuid:='3b17d706-6efa-4264-80b0-ec296397f6cf';active_hand uuid:='f420f331-d986-4278-acba-dcdb7303a5ba';
 actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 item record;e public.tournament_entries%ROWTYPE;s public.tournament_seats%ROWTYPE;prior jsonb;before_entry jsonb;
 immutable text;after_immutable text;proof record;count_value bigint;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR md5(replace(pg_get_functiondef('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),chr(13),''))<>'b6a5e93807c3ca7117506639536562ad'
 THEN RAISE EXCEPTION 'correction199_isolated_qualified_local_only';END IF;
 LOCK TABLE public.tournaments,public.tournament_tables,public.table_sessions,public.tournament_hands,
  public.hand_players,public.hand_actions,public.tournament_entries,public.tournament_seats,
  public.tournament_chip_counts,public.tournament_settlement_outcomes,public.tracker_historical_display_queue,
  public.cashier_buyin_movements,public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  WHERE t.id=tour AND c.id=club AND c.owner_id=actor AND t.status='live' AND t.name='Cash identity local TEST')
 OR (SELECT count(*) FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress')<>1
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=active_hand AND tournament_id=tour
  AND hand_number=30 AND status='in_progress' AND source_revision=18 AND NOT is_voided
  AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc')
 OR (SELECT id FROM public.tournament_hands WHERE tournament_id=tour AND status='completed' AND NOT is_voided ORDER BY created_at DESC,id DESC LIMIT 1) IS DISTINCT FROM previous_hand
 THEN RAISE EXCEPTION 'correction199_exact_retained_journey_changed';END IF;
 -- Chain scope includes later hands, so starting30 legitimately changes its hash.
 -- The worker's historical_display proof is the exact single-hand evidence here.
 SELECT o.id,o.source_chain_hash INTO STRICT proof FROM public.tournament_settlement_outcomes o
 CROSS JOIN LATERAL (SELECT public.get_tracker_historical_display_snapshot(previous_hand,tour) AS snapshot) h
 WHERE o.hand_id=previous_hand AND o.tournament_id=tour AND o.verification_scope='historical_display' AND o.status='verified'
  AND o.source_revision=19 AND o.source_revision=(h.snapshot->>'sourceRevision')::bigint
  AND o.source_chain_hash=h.snapshot->>'sourceChainHash'
  AND EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes c WHERE c.hand_id=previous_hand
   AND c.tournament_id=tour AND c.verification_scope='chain' AND c.source_revision=19
   AND c.actor_user_id=actor AND c.idempotency_key='825c183b-d141-4005-9bf2-6c414613cc5a');
 SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id=tour),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id WHERE h.tournament_id=tour),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id=tour),
  'seats',(SELECT jsonb_agg(to_jsonb(seat_row) ORDER BY seat_row.id) FROM public.tournament_seats seat_row WHERE seat_row.tournament_id=tour),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id=tour),
  'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE tournament_id=tour),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text) INTO immutable;
 FOR item IN SELECT * FROM (VALUES
  ('96ae5f01-7e6e-4344-895a-2b5cdbf124cd'::uuid,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103'::uuid,1,57200,58600),
  ('9384eec9-8014-4d38-a1b0-03a35d264aa9'::uuid,'533feda3-28c5-4194-bdf3-53a07c41305b'::uuid,2,2800,1400)
 )v(entry_id,player,seat_number,old_stack,new_stack) LOOP
  SELECT * INTO STRICT e FROM public.tournament_entries WHERE id=item.entry_id;
  SELECT * INTO STRICT s FROM public.tournament_seats WHERE entry_id=e.id AND is_active;
  SELECT chip_count INTO STRICT count_value FROM public.tournament_chip_counts WHERE tournament_id=tour AND player_id=item.player AND entry_number=1;
  IF e.tournament_id<>tour OR e.player_id<>item.player OR e.entry_no<>1 OR e.status<>'seated'
   OR e.seat_id IS DISTINCT FROM s.id OR e.seat_number IS DISTINCT FROM item.seat_number
   OR s.tournament_id<>tour OR s.player_id<>item.player OR s.entry_number<>1 OR s.seat_number<>item.seat_number
   OR s.status<>'active' OR s.chip_count<>item.new_stack OR count_value<>item.new_stack
   OR s.tournament_table_id<>'d294f4a4-082b-4efc-a6ca-1f96579ea344' OR s.table_session_id<>'ee2b9393-0c96-42f9-8667-7f306edeb9bc'
   OR NOT EXISTS(SELECT 1 FROM public.hand_players p WHERE p.hand_id=previous_hand AND p.player_id=item.player AND p.entry_number=1 AND p.ending_stack=item.new_stack)
   OR NOT EXISTS(SELECT 1 FROM public.hand_players p WHERE p.hand_id=active_hand AND p.player_id=item.player AND p.entry_number=1 AND p.starting_stack=item.new_stack AND p.ending_stack IS NULL)
  THEN RAISE EXCEPTION 'correction199_exact_entry_evidence_changed';END IF;
  SELECT payload INTO prior FROM public.audit_logs WHERE action='local_tracker_entry_projection_repair' AND entity_id=e.id AND payload->>'repair_key'='correction199-retained-hand30-entry-parity';
  IF (SELECT count(*) FROM public.audit_logs WHERE action='local_tracker_entry_projection_repair' AND entity_id=e.id AND payload->>'repair_key'='correction199-retained-hand30-entry-parity')>1 THEN RAISE EXCEPTION 'correction199_duplicate_repair_audit';END IF;
  IF prior IS NULL THEN
   IF e.current_stack<>item.old_stack THEN RAISE EXCEPTION 'correction199_entry_would_overwrite';END IF;
   before_entry:=to_jsonb(e);
   UPDATE public.tournament_entries SET current_stack=item.new_stack,updated_at=now() WHERE id=e.id AND current_stack=item.old_stack;
   IF NOT FOUND THEN RAISE EXCEPTION 'correction199_entry_repair_conflict';END IF;
   INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload) VALUES(club,actor,'local_tracker_entry_projection_repair','tournament_entry',e.id,
    jsonb_build_object('repair_key','correction199-retained-hand30-entry-parity','local_only',true,'before',before_entry,'after_stack',item.new_stack,
     'prior_hand',previous_hand,'active_hand',active_hand,'proof_id',proof.id,'verification_scope','historical_display','source_chain_hash',proof.source_chain_hash,
     'reason','Reconcile omitted mutable entry projection to verified correction and next-hand immutable starting snapshot; no chip issuance or history rewrite'));
  ELSIF e.current_stack<>item.new_stack OR prior->>'proof_id' IS DISTINCT FROM proof.id::text OR prior->>'after_stack' IS DISTINCT FROM item.new_stack::text THEN
   RAISE EXCEPTION 'correction199_repair_replay_conflict';
  END IF;
 END LOOP;
 -- Exact before/after immutable facts, excluding ONLY the two mutable entries and append-only audit.
 SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id=tour),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id WHERE h.tournament_id=tour),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id=tour),
  'seats',(SELECT jsonb_agg(to_jsonb(seat_row) ORDER BY seat_row.id) FROM public.tournament_seats seat_row WHERE seat_row.tournament_id=tour),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id=tour),
  'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE tournament_id=tour),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text) INTO after_immutable;
 IF immutable IS DISTINCT FROM after_immutable THEN RAISE EXCEPTION 'correction199_repair_touched_immutable_facts';END IF;
 RAISE NOTICE 'CORRECTION199_EXACT_LOCAL_ENTRY_RECONCILIATION_AUDITED_NO_HISTORY_CHIP_CASH_DELTA_PASS';
END $repair$;
SET CONSTRAINTS ALL IMMEDIATE;
-- CORRECTION199_LOCAL_REPAIR_END
ROLLBACK;
