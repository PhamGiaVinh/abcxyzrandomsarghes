\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'history381_local_only';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure)<>'879904dce05ea6d2cadefdd9935e350a' THEN RAISE EXCEPTION 'history381_reader_drift';END IF;
 IF (SELECT count(*) FROM public.tournament_hands WHERE tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c' AND tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND status='completed' AND NOT is_voided)<>13 THEN RAISE EXCEPTION 'history381_exact_retained_thirteen_required';END IF;
END $$;
CREATE FUNCTION pg_temp.facts381() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_hands t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.hand_actions t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.hand_players t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_settlement_outcomes t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cashier_buyin_movements t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_prize_payments t))::text);
$$;
CREATE TEMP TABLE baseline381 AS SELECT pg_temp.facts381() AS fingerprint;
CREATE TEMP TABLE scope381 AS
 SELECT id,source_revision FROM public.tournament_hands
 WHERE tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c' AND status='completed' AND NOT is_voided
 ORDER BY created_at DESC,id DESC OFFSET 5 LIMIT 1;
CREATE TEMP TABLE pages381(kind text PRIMARY KEY,payload jsonb);
GRANT SELECT,INSERT ON pages381 TO anon;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claim.role='anon';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
INSERT INTO pages381 VALUES ('head',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,NULL,NULL));
INSERT INTO pages381 SELECT 'before',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,(payload->'nextCursor'->>'createdAt')::timestamptz,(payload->'nextCursor'->>'id')::uuid) FROM pages381 WHERE kind='head';
RESET ROLE;
DO $$ DECLARE target uuid; item jsonb; BEGIN
 SELECT id INTO STRICT target FROM scope381;
 SELECT value INTO STRICT item FROM pages381 p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'items') WHERE p.kind='before' AND value->>'handId'=target::text;
 IF item->'result'->>'status'<>'verified' OR jsonb_array_length(item->'result'->'recipients')<1 THEN RAISE EXCEPTION 'history381_original_verified_recipient_required';END IF;
END $$;
SAVEPOINT changed381;
-- Deliberately corrupt one source amount to exercise invalidation, not a legal
-- correction RPC/business authorization test. This entire scope is rolled back.
UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id=(SELECT id FROM scope381);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN scope381 s ON s.id=h.id WHERE h.source_revision>s.source_revision) THEN RAISE EXCEPTION 'history381_revision_not_advanced';END IF;
END $$;
SET LOCAL ROLE anon;
INSERT INTO pages381 SELECT 'pending',public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,(payload->'nextCursor'->>'createdAt')::timestamptz,(payload->'nextCursor'->>'id')::uuid) FROM pages381 WHERE kind='head';
RESET ROLE;
DO $$ DECLARE before_ids jsonb; after_ids jsonb; item jsonb; BEGIN
 SELECT jsonb_agg(value->>'handId' ORDER BY ord) INTO before_ids FROM pages381 p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'items') WITH ORDINALITY j(value,ord) WHERE kind='before';
 SELECT jsonb_agg(value->>'handId' ORDER BY ord) INTO after_ids FROM pages381 p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'items') WITH ORDINALITY j(value,ord) WHERE kind='pending';
 IF before_ids IS DISTINCT FROM after_ids THEN RAISE EXCEPTION 'history381_correction_moved_keyset_rows';END IF;
 SELECT value INTO STRICT item FROM pages381 p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'items') WHERE p.kind='pending' AND value->>'handId'=(SELECT id::text FROM scope381);
 IF item->'result'->>'status'<>'pending' OR item->'result' ? 'recipients' THEN RAISE EXCEPTION 'history381_old_winner_still_public';END IF;
END $$;
UPDATE public.tournament_hands SET status='voided',is_voided=true WHERE id=(SELECT id FROM scope381);
SET LOCAL ROLE anon;
WITH RECURSIVE pages(n,payload) AS (
 SELECT 1,payload FROM pages381 WHERE kind='head'
 UNION ALL
 SELECT n+1,public.get_public_tournament_table_history_v2('4cd3af4d-7e1d-4042-855f-04fb6777e580','8508d715-cd7c-4f1f-bb0d-223d967e355c',5,(payload->'nextCursor'->>'createdAt')::timestamptz,(payload->'nextCursor'->>'id')::uuid)
 FROM pages WHERE payload->'nextCursor' IS DISTINCT FROM 'null'::jsonb AND n<10
)
INSERT INTO pages381 SELECT 'void_pages',jsonb_agg(payload ORDER BY n) FROM pages;
RESET ROLE;
DO $$ DECLARE seen uuid[]; expected uuid[]; BEGIN
 SELECT array_agg((item->>'handId')::uuid ORDER BY page_ord,item_ord) INTO seen FROM pages381 p CROSS JOIN LATERAL jsonb_array_elements(p.payload) WITH ORDINALITY pages(page,page_ord) CROSS JOIN LATERAL jsonb_array_elements(page->'items') WITH ORDINALITY items(item,item_ord) WHERE p.kind='void_pages';
 SELECT array_agg(id ORDER BY created_at DESC,id DESC) INTO expected FROM public.tournament_hands WHERE tournament_table_id='8508d715-cd7c-4f1f-bb0d-223d967e355c' AND status='completed' AND NOT is_voided;
 IF cardinality(seen)<>12 OR seen IS DISTINCT FROM expected OR (SELECT count(DISTINCT v) FROM unnest(seen) v)<>12 THEN RAISE EXCEPTION 'history381_void_pagination_duplicate_or_missing';END IF;
END $$;
ROLLBACK TO changed381;
DO $$ BEGIN IF pg_temp.facts381() IS DISTINCT FROM (SELECT fingerprint FROM baseline381) THEN RAISE EXCEPTION 'history381_rollback_changed_global_facts';END IF;END $$;
SELECT 'HISTORY381_EXISTING_MAIN13_ANON_PAGE2_CORRECTION_PENDING_NO_RECIPIENT_VOID12_UNIQUE_ROLLBACK_PASS';
ROLLBACK;
