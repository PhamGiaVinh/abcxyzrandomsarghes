CREATE FUNCTION pg_temp.manual_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'manual_prototype_test: %',label; END IF; END $$;
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
\echo MANUAL_CARD_PROTOTYPE_OUTSIDER_RECEIPT_FAULT_RELEASED_PASS
