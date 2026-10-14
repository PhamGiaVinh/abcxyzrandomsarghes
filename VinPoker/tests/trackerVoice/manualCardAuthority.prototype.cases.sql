DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_20261014' OR current_user<>'postgres'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55464
 OR current_setting('manual75.fixture',true) IS DISTINCT FROM 'owned-manual-authority'
 THEN RAISE EXCEPTION 'owned_manual_prototype_rollback_harness_required'; END IF;
END $$;
CREATE FUNCTION pg_temp.manual_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'manual_prototype_test: %',label; END IF; END $$;
DO $$ DECLARE expected record; actual record; BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('floor_private.manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)','419f17a4a04937244c2519b75d4c4b96',true,'v'),
  ('public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)','e5a5f946ed187baf910cbc7f7de8e746',false,'v'),
  ('floor_private.manual_card_receipt_prototype(text)','914e90524f7ef265c65c421dd680f05c',true,'s'),
  ('public.get_manual_card_receipt_prototype(text)','ff336d471723c238d35529f315fc2202',false,'s')
 ) AS definitions(signature,digest,definer,volatility) LOOP
  SELECT * INTO STRICT actual FROM pg_proc WHERE oid=expected.signature::regprocedure;
  PERFORM pg_temp.manual_assert(
   md5(replace(pg_get_functiondef(actual.oid),chr(13),''))=expected.digest
   AND pg_get_userbyid(actual.proowner)='postgres'
   AND actual.prosecdef=expected.definer AND actual.provolatile::text=expected.volatility
   AND actual.proconfig=ARRAY['search_path=""']::text[]
   AND actual.proacl::text='{postgres=X/postgres,authenticated=X/postgres}',
   'exact manual prototype function body/owner/path/ACL: '||expected.signature);
 END LOOP;
 PERFORM pg_temp.manual_assert(
  (SELECT relrowsecurity AND pg_get_userbyid(relowner)='postgres' FROM pg_class
   WHERE oid='floor_private.manual_card_receipts_prototype'::regclass)
  AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='floor_private'
   AND tablename='manual_card_receipts_prototype')
  AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL
   aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE c.oid='floor_private.manual_card_receipts_prototype'::regclass
    AND a.grantee<>c.relowner),
  'receipt table owner/RLS and no non-owner direct privileges');
END $$;
SELECT pg_temp.manual_assert(
 (SELECT proargnames=ARRAY['p_hand_id','p_session_id','p_epoch','p_revision','p_request_key','p_cards']::text[]
  AND NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[]
  FROM pg_proc WHERE oid='public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure)
 AND (SELECT NOT prosecdef AND provolatile='s' AND proargnames=ARRAY['p_request_key']::text[]
  FROM pg_proc WHERE oid='public.get_manual_card_receipt_prototype(text)'::regprocedure)
 AND (SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[]
  FROM pg_proc WHERE oid='floor_private.manual_card_receipt_prototype(text)'::regprocedure)
 AND md5(pg_get_functiondef('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)'::regprocedure))
  ='53374e21fe6d323affa8a074402f4b85'
 AND NOT has_function_privilege('service_role','public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.get_manual_card_receipt_prototype(text)','EXECUTE'),
 'named PostgREST arguments, invoker wrappers, stable private receipt and unchanged source writer');
SELECT source_revision AS revision FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001' \gset manual_before_
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text AS payload \gset manual_first_
RESET ROLE;
\echo :manual_first_payload
SELECT pg_temp.manual_assert(:'manual_first_payload'::jsonb->>'status'='success'
 AND (:'manual_first_payload'::jsonb->>'entry_count')::integer=1,'assigned Dealer canonical write');
SELECT source_revision AS revision FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001' \gset manual_after_
SELECT pg_temp.manual_assert(:manual_after_revision>:manual_before_revision
 AND (:'manual_first_payload'::jsonb->>'expected_source_revision')::bigint=:manual_before_revision
 AND (:'manual_first_payload'::jsonb->>'committed_source_revision')::bigint=:manual_after_revision
 AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
  WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2)
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'cards/revision/receipt committed together');
SET ROLE authenticated;
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text AS payload \gset manual_retry_
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_conflict_
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',2,:manual_after_revision,'manual-prototype-key-stale',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_stale_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_retry_payload'::jsonb=:'manual_first_payload'::jsonb
 AND :'manual_conflict_payload'::jsonb->>'error'='idempotency_conflict'
 AND :'manual_stale_payload'::jsonb->>'error'='stale_manual_card_context'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'replay/conflict/stale epoch zero additional mutation');
SELECT pg_temp.manual_assert(NOT has_schema_privilege('authenticated','floor_private','USAGE')
 AND NOT has_table_privilege('authenticated','floor_private.manual_card_receipts_prototype','SELECT')
 AND NOT has_function_privilege('anon','public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)','EXECUTE'),
 'compiled wrapper does not open private schema or receipts');
\echo MANUAL_CARD_PROTOTYPE_ASSIGNED_REPLAY_CONFLICT_EPOCH_PASS
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
DO $$ DECLARE remote_locked boolean; verdict jsonb; revision_before bigint; BEGIN
 SELECT source_revision INTO revision_before FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001';
 PERFORM public.dblink_connect('manual75_key_holder','host=127.0.0.1 port='||inet_server_port()
  ||' user=postgres dbname='||current_database()||' application_name=manual75_key_holder');
 PERFORM public.dblink_exec('manual75_key_holder','BEGIN');
 SELECT locked INTO remote_locked FROM public.dblink('manual75_key_holder',
  $remote$SELECT pg_try_advisory_xact_lock(hashtextextended(
   '81200000-0000-4000-8000-000000000001:manual-prototype-concurrent-key',75))$remote$)
  AS held(locked boolean);
 PERFORM pg_temp.manual_assert(remote_locked,'independent backend holds exact request lock');
 SET LOCAL ROLE authenticated;
 verdict:=public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',1,revision_before,'manual-prototype-concurrent-key',
  '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb);
 RESET ROLE;
 PERFORM pg_temp.manual_assert(verdict->>'error'='manual_card_request_busy'
  AND (SELECT source_revision=revision_before FROM public.tournament_hands
   WHERE id='86000000-0000-4000-8000-000000000001')
  AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
   WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2)
  AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
  'real two-backend request contention returns busy without cards/revision/receipt write');
 PERFORM public.dblink_exec('manual75_key_holder','ROLLBACK');
 PERFORM public.dblink_disconnect('manual75_key_holder');
EXCEPTION WHEN OTHERS THEN
 RESET ROLE;
 IF 'manual75_key_holder'=ANY(coalesce(public.dblink_get_connections(),ARRAY[]::text[])) THEN
  PERFORM public.dblink_exec('manual75_key_holder','ROLLBACK');
  PERFORM public.dblink_disconnect('manual75_key_holder');
 END IF;
 RAISE;
END $$;
\echo MANUAL_CARD_PROTOTYPE_TWO_BACKEND_REQUEST_BUSY_PASS
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81500000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81500000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_after_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_outsider_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_outsider_payload'::jsonb->>'error'='actor_not_allowed'
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'outsider cannot replay another actor receipt or mutate');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81600000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_after_revision,'manual-prototype-foreign-owner',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_foreign_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_foreign_payload'::jsonb->>'error'='actor_not_allowed'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'foreign club Owner cannot write or create receipt');
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',false);
CREATE FUNCTION pg_temp.manual_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'manual_receipt_injected_fault'; END $$;
CREATE TRIGGER manual_receipt_fault BEFORE INSERT ON floor_private.manual_card_receipts_prototype
 FOR EACH ROW EXECUTE FUNCTION pg_temp.manual_receipt_fault();
DO $$ DECLARE revision_before bigint; rejected boolean:=false; hand_before text; players_before text; queue_before text; BEGIN
 SELECT source_revision INTO revision_before FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001';
 SELECT md5(to_jsonb(h)::text) INTO hand_before FROM public.tournament_hands h
  WHERE id='86000000-0000-4000-8000-000000000001';
 SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) INTO players_before FROM public.hand_players p
  WHERE hand_id='86000000-0000-4000-8000-000000000001';
 SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb)::text) INTO queue_before
  FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001';
 BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
   '83500000-0000-4000-8000-000000000001',1,revision_before,'manual-prototype-receipt-fault',
   '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'manual_receipt_injected_fault' THEN RAISE; END IF;
  rejected:=true;
 END;
 RESET ROLE;
 PERFORM pg_temp.manual_assert(rejected
  AND hand_before=(SELECT md5(to_jsonb(h)::text) FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001')
  AND players_before=(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.hand_players p WHERE hand_id='86000000-0000-4000-8000-000000000001')
  AND queue_before=(SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision),'[]'::jsonb)::text) FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001')
  AND (SELECT source_revision=revision_before FROM public.tournament_hands
    WHERE id='86000000-0000-4000-8000-000000000001')
  AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
    WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2)
  AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'receipt fault rolls back cards/revision/receipt');
END $$;
DROP TRIGGER manual_receipt_fault ON floor_private.manual_card_receipts_prototype;
DO $$ DECLARE bad_cards jsonb; verdict jsonb; snapshot_before text; snapshot_after text; revision_before bigint; ordinal integer:=0; BEGIN
 SELECT source_revision INTO revision_before FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001';
 SELECT md5(jsonb_build_array(to_jsonb(h),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p WHERE p.hand_id=h.id),
  (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.source_revision),'[]'::jsonb)
   FROM public.tracker_historical_display_queue q WHERE q.hand_id=h.id))::text)
 INTO snapshot_before FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
 FOREACH bad_cards IN ARRAY ARRAY[
  '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Jh"]}]'::jsonb,
  '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":99,"hole_cards":["Jh","Js"]}]'::jsonb
 ] LOOP
  ordinal:=ordinal+1;
  SET LOCAL ROLE authenticated;
  verdict:=public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
   '83500000-0000-4000-8000-000000000001',1,
   revision_before,
   'manual-prototype-invalid-'||ordinal,bad_cards);
  RESET ROLE;
  PERFORM pg_temp.manual_assert(verdict->>'error'=CASE ordinal
    WHEN 1 THEN 'Duplicate cards in array' WHEN 2 THEN 'player_not_in_hand' END
   AND verdict->>'status' IS DISTINCT FROM 'success',
   'invalid deck or entry must be denied');
 END LOOP;
 SELECT md5(jsonb_build_array(to_jsonb(h),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p WHERE p.hand_id=h.id),
  (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.source_revision),'[]'::jsonb)
   FROM public.tracker_historical_display_queue q WHERE q.hand_id=h.id))::text)
 INTO snapshot_after FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.manual_assert(snapshot_before=snapshot_after
  AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
  'invalid deck/entry leaves full hand, players, queue and receipts unchanged');
END $$;
\echo MANUAL_CARD_PROTOTYPE_INVALID_DECK_ENTRY_ZERO_WRITE_PASS
-- Controlled epoch ABA fixture: this is not a canonical mode-switch RPC test.
UPDATE public.table_sessions SET control_epoch=control_epoch+1
 WHERE id='83500000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text AS payload \gset manual_epoch_replay_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_epoch_replay_payload'::jsonb->>'error'='stale_manual_card_context'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
 'old successful receipt does not bypass current epoch');
UPDATE public.table_sessions SET control_epoch=control_epoch+1
 WHERE id='83500000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_after_revision,'manual-prototype-epoch-aba',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_epoch_aba_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_epoch_aba_payload'::jsonb->>'error'='stale_manual_card_context'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
 'same tracker mode at a later generation cannot accept old epoch');
-- Restore only the synthetic rollback fixture for the subsequent release case.
UPDATE public.table_sessions SET control_epoch=1
 WHERE id='83500000-0000-4000-8000-000000000001';
\echo MANUAL_CARD_PROTOTYPE_EPOCH_REPLAY_ABA_PASS
UPDATE public.dealer_assignments SET status='completed',released_at=now()
 WHERE id='88000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_after_revision,'manual-prototype-after-release',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset manual_released_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_released_payload'::jsonb->>'error'='dealer_assignment_invalid'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),'released assignment cannot create a new write');
SET ROLE authenticated;
SELECT public.show_manual_cards_prototype('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text AS payload \gset manual_released_replay_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_released_replay_payload'::jsonb->>'error'='dealer_assignment_invalid'
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
 'released assignment cannot turn historical receipt into current mutation success');
SET ROLE authenticated;
SELECT public.get_manual_card_receipt_prototype('manual-prototype-key-0001')::text AS payload \gset manual_reconcile_
SELECT set_config('request.jwt.claim.sub','81500000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81500000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.get_manual_card_receipt_prototype('manual-prototype-key-0001')::text AS payload \gset manual_reconcile_outsider_
RESET ROLE;
SELECT pg_temp.manual_assert(:'manual_reconcile_payload'::jsonb->>'status'='committed'
 AND (:'manual_reconcile_payload'::jsonb->>'expected_source_revision')::bigint=:manual_before_revision
 AND (:'manual_reconcile_payload'::jsonb->>'committed_source_revision')::bigint=:manual_after_revision
 AND :'manual_reconcile_payload'::jsonb->>'request_hash'=
  encode(extensions.digest(jsonb_build_array('81200000-0000-4000-8000-000000000001'::uuid,
   '86000000-0000-4000-8000-000000000001'::uuid,'83500000-0000-4000-8000-000000000001'::uuid,
   1::bigint,:manual_before_revision::bigint,
   '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text,'sha256'),'hex')
 AND :'manual_reconcile_payload'::jsonb->>'hand_id'='86000000-0000-4000-8000-000000000001'
 AND NOT (:'manual_reconcile_payload'::jsonb ? 'hole_cards')
 AND :'manual_reconcile_outsider_payload'::jsonb->>'status'='not_found'
 AND NOT has_function_privilege('anon','public.get_manual_card_receipt_prototype(text)','EXECUTE')
 AND NOT has_schema_privilege('authenticated','floor_private','USAGE')
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT count(*)=1 FROM floor_private.manual_card_receipts_prototype),
 'read-only reconciliation after release is actor-bound and does not restore mutation authority');
\echo MANUAL_CARD_PROTOTYPE_RECONCILIATION_AFTER_RELEASE_PASS
\echo MANUAL_CARD_PROTOTYPE_OUTSIDER_RECEIPT_FAULT_RELEASED_PASS
