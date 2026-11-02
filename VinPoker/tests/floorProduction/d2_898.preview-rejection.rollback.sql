-- Existing pre-seating negative-test fixture only. Never revive a completed journey.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.d2_789_fingerprint() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_entries x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_seats x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_tables x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.table_sessions x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.cashier_buyin_movements x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.tournament_chip_counts x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.table_session_seat_locks x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM private.multi_day_initial_draw_plans_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM private.multi_day_initial_draw_applications_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_package_release_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.centerpoint_tournament_ops_release x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_stack_revisions_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_requests_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.multi_day_final_seatings_v1 x),
  (SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY md5(to_jsonb(x)::text)),'')) FROM public.chip_bag x)
 )::text)
$$;
CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ranking860_local';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT (SELECT package_hash FROM floor_private.ranking860_install_backup)='d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='0f56388a-c47f-48fd-970a-4f5589627d4b' AND status='active');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
 ASSERT (SELECT count(*) FROM public.multi_day_final_participations_v1 WHERE event_id='e6551af0-e6d0-4fb0-9342-fdd7465fcaf2')=1;
END $$;
CREATE TEMP TABLE d2_789_context(plan_id uuid,table_id uuid,session_id uuid,seat integer,stack bigint) ON COMMIT DROP;
-- Temporary qualification scope, restored by outer ROLLBACK, not Auto/Daybreak.
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['399956aa-7858-422a-ad34-ca7ee52ff64d'::uuid]) x) WHERE id;
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['399956aa-7858-422a-ad34-ca7ee52ff64d'::uuid]) x) WHERE id;
DO $$ DECLARE snapshot jsonb; plan jsonb; tables uuid[]; assignment jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','ba3e052f-27d5-4da5-b832-0b5d9cecbf2f',true);
 PERFORM set_config('request.jwt.claims','{"sub":"ba3e052f-27d5-4da5-b832-0b5d9cecbf2f","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 snapshot:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
 ASSERT jsonb_array_length(snapshot->'players')=1 AND snapshot->'players'->0->>'state'='UNSEATED';
 ASSERT jsonb_array_length(snapshot->'tables')=3;
 SELECT array_agg((x->>'tournamentTableId')::uuid ORDER BY x->>'tournamentTableId') INTO tables FROM jsonb_array_elements(snapshot->'tables') x;
 plan:=public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',tables,snapshot->>'sourceHash',gen_random_uuid());
 ASSERT plan->>'state'='PLANNED' AND jsonb_array_length(plan->'assignments')=1;
 assignment:=plan->'assignments'->0;
 PERFORM set_config('role','none',true);
 INSERT INTO d2_789_context VALUES((plan->>'planId')::uuid,(assignment->>'tournamentTableId')::uuid,(assignment->>'tableSessionId')::uuid,(assignment->>'seatNumber')::integer,(assignment->>'stack')::bigint);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b'),'preview wrote entries';
END $$;

-- New probes operate only on the existing pre-seat fixture and all rollback.
CREATE FUNCTION pg_temp.d2_897_stale(change_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; denied boolean:=false;
BEGIN
 SELECT plan_id INTO STRICT p FROM d2_789_context;
 BEGIN
  EXECUTE change_sql;
  PERFORM set_config('role','authenticated',true);
  PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 EXCEPTION WHEN serialization_failure THEN
  ASSERT SQLERRM='multi_day_initial_draw_table_stale',SQLERRM;denied:=true;
 END;
 ASSERT denied,'changed selected table was accepted';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p);
END $$;
SELECT pg_temp.d2_897_stale('UPDATE public.tournament_tables SET max_seats=CASE max_seats WHEN 8 THEN 9 ELSE 8 END WHERE id=(SELECT table_id FROM d2_789_context)');
SELECT pg_temp.d2_897_stale('UPDATE public.tournament_tables SET status=''closed'' WHERE id=(SELECT table_id FROM d2_789_context)');
SELECT pg_temp.d2_897_stale('UPDATE public.table_sessions SET closed_at=now() WHERE id=(SELECT session_id FROM d2_789_context)');

DO $$ DECLARE snapshot jsonb;t uuid;prior_count integer;denied boolean;changed jsonb;BEGIN
 SELECT table_id INTO STRICT t FROM d2_789_context;
 SELECT count(*) INTO prior_count FROM private.multi_day_initial_draw_plans_v1;
 PERFORM set_config('role','authenticated',true);
 snapshot:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
 PERFORM set_config('role','none',true);
 denied:=false;
 BEGIN
  UPDATE public.tournament_tables SET status='closed' WHERE id=t;
  PERFORM set_config('role','authenticated',true);
  PERFORM public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',ARRAY[t],snapshot->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN check_violation THEN
  ASSERT SQLERRM='multi_day_initial_draw_table_blocked',SQLERRM;denied:=true;
 END;
 ASSERT denied,'closed table preview accepted';
 denied:=false;
 BEGIN
  PERFORM set_config('role','authenticated',true);
  SELECT public.multi_day_correct_final_seed_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',(snapshot->'players'->0->>'playerId')::uuid,(snapshot->'players'->0->>'stack')::bigint+1,0,'LOCAL898 rollback seed correction','local://898/seed-evidence',gen_random_uuid()) INTO changed;
  ASSERT changed->>'state'='REVISED_PRE_SEAT';
  PERFORM public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',ARRAY[t],snapshot->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN serialization_failure THEN
  ASSERT SQLERRM='multi_day_initial_draw_source_stale',SQLERRM;denied:=true;
 END;
 ASSERT denied,'stale source preview accepted';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM private.multi_day_initial_draw_plans_v1)=prior_count,'rejected preview created a plan';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;

DO $$ DECLARE snapshot jsonb; tables uuid[]; p uuid; original_request uuid; r jsonb; denied boolean; count_before integer; input uuid[]; i integer;
BEGIN
 SELECT plan_id INTO STRICT p FROM d2_789_context;
 SELECT request_id INTO STRICT original_request FROM private.multi_day_initial_draw_plans_v1 WHERE id=p;
 SELECT count(*) INTO count_before FROM private.multi_day_initial_draw_plans_v1;
 PERFORM set_config('role','authenticated',true);
 snapshot:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
 SELECT array_agg((x->>'tournamentTableId')::uuid ORDER BY x->>'tournamentTableId') INTO tables FROM jsonb_array_elements(snapshot->'tables')x;
 r:=public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',tables,snapshot->>'sourceHash',original_request);
 ASSERT (r->>'planId')::uuid=p AND r->>'idempotent'='true','same key did not recover original preview';
 FOR i IN 1..3 LOOP
  input:=CASE i WHEN 1 THEN ARRAY[tables[1],tables[1]] WHEN 2 THEN ARRAY[NULL::uuid] ELSE ARRAY[]::uuid[] END;
  denied:=false;
  BEGIN
   PERFORM public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',input,snapshot->>'sourceHash',gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN
   ASSERT SQLERRM=CASE i WHEN 1 THEN 'multi_day_initial_draw_duplicate_table' ELSE 'multi_day_initial_draw_invalid' END,SQLERRM;denied:=true;
  END;
  ASSERT denied,'invalid table selection accepted';
 END LOOP;
 denied:=false;
 BEGIN
  PERFORM public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',ARRAY[tables[1]],snapshot->>'sourceHash',original_request);
 EXCEPTION WHEN unique_violation THEN
  ASSERT SQLERRM='multi_day_initial_draw_request_conflict',SQLERRM;denied:=true;
 END;
 ASSERT denied,'same key with changed table selection accepted';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM private.multi_day_initial_draw_plans_v1)=count_before,'rejected preview persisted extra plan';
END $$;

DO $$ DECLARE p uuid; result jsonb; replay jsonb; apply_key uuid:=gen_random_uuid(); expected_stack bigint; denied boolean:=false; after_apply text;
BEGIN
 SELECT plan_id,stack INTO STRICT p,expected_stack FROM d2_789_context;
 PERFORM set_config('role','authenticated',true);
 result:=public.multi_day_apply_initial_draw_v1(p,apply_key);
 ASSERT result->>'state'='APPLIED' AND jsonb_array_length(result->'seatReceipts')=1;
 PERFORM set_config('role','none',true);
 after_apply:=pg_temp.d2_789_fingerprint();
 PERFORM set_config('role','authenticated',true);
 replay:=public.multi_day_apply_initial_draw_v1(p,apply_key);
 ASSERT replay=(result||jsonb_build_object('idempotent',true)),'same-key apply replay changed original receipt';
 BEGIN
  PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 EXCEPTION WHEN unique_violation THEN
  ASSERT SQLERRM='multi_day_initial_draw_already_applied_use_receipt',SQLERRM;denied:=true;
 END;
 ASSERT denied,'new key reapplied an existing draw';
 PERFORM set_config('role','none',true);
 ASSERT after_apply=pg_temp.d2_789_fingerprint(),'apply replay or rejected new key changed persisted facts';
 ASSERT (SELECT count(*)=1 AND sum(current_stack)=expected_stack FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
 ASSERT (SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p)=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'rollback did not preserve protected source facts/configuration';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;
SELECT 'D2_898_NATIVE_PREVIEW_STALE_SOURCE_BLOCKED_TABLE_NO_PLAN_ALL_ROLLBACK_PASS';
