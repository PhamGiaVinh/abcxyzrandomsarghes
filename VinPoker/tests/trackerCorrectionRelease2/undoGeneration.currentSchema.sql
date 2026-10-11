-- Rollback-only authenticated active-hand undo regression.
-- Fixture assignments do not prove an operational dealer assignment journey.
DO $$ BEGIN IF md5(replace(pg_get_functiondef('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),''))
 IS DISTINCT FROM '9a0c1397480381859a12fbd6b619cd87' THEN RAISE EXCEPTION 'action_function_drift'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE action_lock AS SELECT public.heartbeat_lock('86000000-0000-4000-8000-000000000001','81400000-0000-4000-8000-000000000001') receipt;
RESET ROLE;
DO $$ BEGIN IF (SELECT receipt->>'status' FROM action_lock) IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'action_lock_not_claimed'; END IF; END $$;
CREATE TEMP TABLE action_before AS SELECT h.id,h.source_revision,s.source_chain_hash FROM public.tournament_hands h
 CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE action_receipt AS SELECT public.record_action('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','check',1,1,'preflop',0,'action-writer-probe',NULL,'81400000-0000-4000-8000-000000000001') receipt;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT receipt->>'status' FROM action_receipt) IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'action_rpc_not_success: %',(SELECT receipt FROM action_receipt); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN action_before b USING(id)
 CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.source_revision=b.source_revision+1 AND s.source_chain_hash IS DISTINCT FROM b.source_chain_hash)
 THEN RAISE EXCEPTION 'action_revision_hash_gap'; END IF;
END $$;
CREATE TEMP TABLE action_after AS SELECT to_jsonb(h) snapshot FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE actions_after AS SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) snapshot FROM public.hand_actions a WHERE hand_id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE action_retry AS SELECT public.record_action('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','check',1,1,'preflop',0,'action-writer-probe',NULL,'81400000-0000-4000-8000-000000000001') receipt;
CREATE TEMP TABLE action_conflict AS SELECT public.record_action('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','call',1,1,'preflop',100,'action-writer-probe',NULL,'81400000-0000-4000-8000-000000000001') receipt;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT receipt->>'status' FROM action_retry) IS DISTINCT FROM 'success' OR (SELECT receipt->>'duplicate' FROM action_retry) IS DISTINCT FROM 'true'
 OR (SELECT receipt->>'action_id' FROM action_retry) IS DISTINCT FROM (SELECT receipt->>'action_id' FROM action_receipt) THEN RAISE EXCEPTION 'action_replay_gap'; END IF;
 IF (SELECT receipt->>'error' FROM action_conflict) IS DISTINCT FROM 'idempotency_key_conflict' THEN RAISE EXCEPTION 'action_conflict_gap: %',(SELECT receipt FROM action_conflict); END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81600000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE action_foreign AS SELECT public.record_action('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','check',2,1,'preflop',0,'foreign-action-probe',NULL,'81600000-0000-4000-8000-000000000001') receipt;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT receipt->>'error' FROM action_foreign) IS DISTINCT FROM 'tracker_lock_owned_by_another'
 OR (SELECT receipt->>'status' FROM action_foreign)='success' THEN RAISE EXCEPTION 'action_foreign_not_denied: %',(SELECT receipt FROM action_foreign); END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_hands h CROSS JOIN action_after b WHERE h.id='86000000-0000-4000-8000-000000000001' AND to_jsonb(h) IS DISTINCT FROM b.snapshot)
 OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a WHERE hand_id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM (SELECT snapshot FROM actions_after)
 THEN RAISE EXCEPTION 'action_retry_or_denial_delta'; END IF;
 IF (SELECT count(*) FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'action_count_gap'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81100000-0000-4000-8000-000000000001"}',true);
INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES('87000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81400000-0000-4000-8000-000000000001','Undo TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,current_state,status) VALUES('87500000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','assigned','checked_in');
INSERT INTO public.dealer_assignments(id,dealer_id,attendance_id,table_id,table_session_id,club_id,assigned_at,status) VALUES('88000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87500000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',now(),'assigned');
INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled) VALUES('81000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81400000-0000-4000-8000-000000000001','undo_open_hand',true);
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
SELECT source_revision AS revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001' \gset undo_
SELECT id AS action_id FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001' \gset undo_
CREATE TEMP TABLE undo_before AS SELECT h.id,h.source_revision,s.source_chain_hash FROM public.tournament_hands h CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE undo_denial_before AS SELECT to_jsonb(h) snapshot FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE undo_denial_actions AS SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) snapshot FROM public.hand_actions a;
CREATE TEMP TABLE undo_denial_queue AS SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision),'[]'::jsonb) snapshot FROM public.tracker_historical_display_queue q;
SET LOCAL ROLE authenticated;
SELECT public.undo_tracker_last_action_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002','86000000-0000-4000-8000-000000000001',:'undo_action_id',:undo_revision,'89900000-0000-4000-8000-000000000002')::text AS receipt \gset wrong_session_
RESET ROLE;
INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled) VALUES('81000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81600000-0000-4000-8000-000000000001','undo_open_hand',true);
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81600000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT public.undo_tracker_last_action_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',:'undo_action_id',:undo_revision,'89900000-0000-4000-8000-000000000003')::text AS receipt \gset foreign_undo_
RESET ROLE;
SELECT :'wrong_session_receipt'::jsonb->>'error'='stale_tracker_context' AND :'foreign_undo_receipt'::jsonb->>'error'='actor_not_allowed' AS valid \gset denial_
\if :denial_valid
\else
\quit 1
\endif
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tournament_hands h CROSS JOIN undo_denial_before b WHERE h.id='86000000-0000-4000-8000-000000000001' AND to_jsonb(h) IS DISTINCT FROM b.snapshot) OR (SELECT count(*) FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001')<>1 OR EXISTS(SELECT 1 FROM public.tracker_correction_operations) THEN RAISE EXCEPTION 'undo_denial_delta'; END IF;
 IF (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.hand_actions a) IS DISTINCT FROM (SELECT snapshot FROM undo_denial_actions)
 OR (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision),'[]'::jsonb) FROM public.tracker_historical_display_queue q) IS DISTINCT FROM (SELECT snapshot FROM undo_denial_queue) THEN RAISE EXCEPTION 'undo_denial_action_queue_delta'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT public.undo_tracker_last_action_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',:'undo_action_id',:undo_revision,'89900000-0000-4000-8000-000000000001')::text AS receipt \gset undo_
RESET ROLE;
SELECT :'undo_receipt'::jsonb AS actual_undo_receipt;
DO $$ BEGIN IF (SELECT count(*) FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001')<>0 THEN RAISE EXCEPTION 'undo_action_not_deleted'; END IF; END $$;
SELECT :'undo_receipt'::jsonb->>'ok'='true' AND (:'undo_receipt'::jsonb->>'source_revision')::bigint>:undo_revision AS valid \gset undo_
\if :undo_valid
\else
\quit 1
\endif
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN undo_before b USING(id) CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.source_revision>b.source_revision AND s.source_chain_hash IS DISTINCT FROM b.source_chain_hash) THEN RAISE EXCEPTION 'undo_generation_hash_gap'; END IF;
 IF EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='86000000-0000-4000-8000-000000000001' AND status IN ('pending','processing')) THEN RAISE EXCEPTION 'active_undo_has_publishable_queue'; END IF;
END $$;
CREATE TEMP TABLE undo_after AS SELECT to_jsonb(h) snapshot FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE undo_queue_after AS SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY source_revision),'[]'::jsonb) snapshot FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.undo_tracker_last_action_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',:'undo_action_id',:undo_revision,'89900000-0000-4000-8000-000000000001')::text AS receipt \gset replay_
SELECT public.undo_tracker_last_action_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',:'undo_action_id',:undo_revision+1,'89900000-0000-4000-8000-000000000001')::text AS receipt \gset conflict_
RESET ROLE;
SELECT (:'replay_receipt'::jsonb - 'duplicate')=(:'undo_receipt'::jsonb - 'duplicate') AND :'replay_receipt'::jsonb->>'duplicate'='true' AND :'conflict_receipt'::jsonb->>'error'='request_key_conflict' AS valid \gset retry_
\if :retry_valid
\else
\quit 1
\endif
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tournament_hands h CROSS JOIN undo_after b WHERE h.id='86000000-0000-4000-8000-000000000001' AND to_jsonb(h) IS DISTINCT FROM b.snapshot) OR EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'undo_replay_hand_delta'; END IF;
 IF (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY source_revision),'[]'::jsonb) FROM public.tracker_historical_display_queue q WHERE hand_id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM (SELECT snapshot FROM undo_queue_after) THEN RAISE EXCEPTION 'undo_replay_queue_delta'; END IF;
 IF (SELECT count(*) FROM public.tracker_correction_operations WHERE actor_user_id='81400000-0000-4000-8000-000000000001' AND idempotency_key='89900000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'undo_receipt_count_gap'; END IF;
END $$;
