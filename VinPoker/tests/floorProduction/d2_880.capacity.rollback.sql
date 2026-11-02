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

DO $$ DECLARE t uuid;cap integer;sess uuid;snapshot jsonb;denied boolean:=false;prior_count integer;BEGIN
 SELECT c.table_id,c.session_id,tt.max_seats INTO STRICT t,sess,cap FROM d2_789_context c JOIN public.tournament_tables tt ON tt.id=c.table_id;
 SELECT count(*) INTO prior_count FROM private.multi_day_initial_draw_plans_v1;
 BEGIN
  INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
  SELECT '0f56388a-c47f-48fd-970a-4f5589627d4b',t,sess,n,'LOCAL880 capacity rollback','ba3e052f-27d5-4da5-b832-0b5d9cecbf2f' FROM generate_series(1,cap)n;
  PERFORM set_config('role','authenticated',true);
  snapshot:=public.multi_day_final_roster_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
  PERFORM public.multi_day_plan_initial_draw_v1('e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',ARRAY[t],snapshot->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN check_violation THEN
  ASSERT SQLERRM='multi_day_initial_draw_insufficient_capacity',SQLERRM;denied:=true;
 END;
 ASSERT denied,'fully locked selected table unexpectedly accepted';
 ASSERT (SELECT count(*) FROM private.multi_day_initial_draw_plans_v1)=prior_count,'denied preview persisted a plan';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;
-- Positive control uses the SAME untouched immutable preview after all probes roll back.
DO $$ DECLARE p uuid; result jsonb; expected_stack bigint;
BEGIN
 SELECT plan_id,stack INTO STRICT p,expected_stack FROM d2_789_context;
 PERFORM set_config('role','authenticated',true);
 result:=public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 ASSERT result->>'state'='APPLIED' AND jsonb_array_length(result->'seatReceipts')=1;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=1 AND sum(current_stack)=expected_stack FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint(),'rollback did not preserve protected source facts/configuration';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
END $$;
SELECT 'D2_880_FULLY_LOCKED_TABLE_CAPACITY_DENIAL_AND_SAME_PLAN_POSITIVE_ROLLBACK_PASS';
