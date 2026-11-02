-- Existing pre-seating negative-test fixture only. Never revive a completed journey.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.d2_789_fingerprint() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_tables x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_chip_counts x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_session_seat_locks x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.multi_day_initial_draw_plans_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY plan_id) FROM private.multi_day_initial_draw_applications_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.multi_day_package_release_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.centerpoint_tournament_ops_release x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.multi_day_final_stack_revisions_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.multi_day_final_requests_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.multi_day_final_seatings_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.chip_bag x)
 )::text)
$$;
CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
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
CREATE FUNCTION pg_temp.d2_789_reject(change_sql text,expected_message text,authenticated_change boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid; denied boolean:=false; changed jsonb;
BEGIN
 SELECT plan_id INTO STRICT p FROM d2_789_context;
 BEGIN
  IF authenticated_change THEN
   PERFORM set_config('role','authenticated',true);
   EXECUTE change_sql INTO changed;
   ASSERT changed->>'state'='REVISED_PRE_SEAT' AND (changed->>'seedRevision')::integer=1,
    'canonical seed correction did not actually change the pre-seat source';
  ELSE
   EXECUTE change_sql;
  END IF;
  PERFORM set_config('role','authenticated',true);
  PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 EXCEPTION WHEN serialization_failure THEN
  ASSERT SQLERRM=expected_message,format('expected %s, got %s',expected_message,SQLERRM);
  denied:=true;
 END;
 ASSERT denied,'stale D2 plan unexpectedly applied';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b'),'rejected plan left entry';
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p),'rejected plan left application';
END $$;
SELECT pg_temp.d2_789_reject(
 'UPDATE public.table_sessions SET revision=revision+1 WHERE id=(SELECT session_id FROM d2_789_context)',
 'multi_day_initial_draw_table_stale');
SELECT pg_temp.d2_789_reject(
 'UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id=(SELECT session_id FROM d2_789_context)',
 'multi_day_initial_draw_table_stale');
SELECT pg_temp.d2_789_reject(
 'UPDATE public.table_sessions SET closed_at=now() WHERE id=(SELECT session_id FROM d2_789_context)',
 'multi_day_initial_draw_table_stale');
SELECT pg_temp.d2_789_reject(
 'INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by) SELECT ''0f56388a-c47f-48fd-970a-4f5589627d4b'',table_id,session_id,seat,''LOCAL789 rollback negative'',''ba3e052f-27d5-4da5-b832-0b5d9cecbf2f'' FROM d2_789_context',
 'multi_day_initial_draw_table_stale');
-- Actual authorized correction, not fabricated bag/version drift or a disabled trigger.
SELECT pg_temp.d2_789_reject(format(
 'SELECT public.multi_day_correct_final_seed_v1(%L::uuid,%L::uuid,%s,0,%L,%L,gen_random_uuid())',
 'e6551af0-e6d0-4fb0-9342-fdd7465fcaf2',player_id,carried_stack+1,
 'LOCAL844 rollback-only seed correction','local://844/seed-evidence'),
 'multi_day_initial_draw_source_stale',true)
FROM public.multi_day_final_participations_v1
WHERE event_id='e6551af0-e6d0-4fb0-9342-fdd7465fcaf2';
DO $$ DECLARE p uuid; denied boolean:=false; BEGIN
 SELECT plan_id INTO STRICT p FROM d2_789_context;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
  PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
  PERFORM set_config('role','authenticated',true);
  PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN
  ASSERT SQLERRM='multi_day_initial_draw_actor_denied';
  denied:=true;
 END;
 ASSERT denied,'unrelated owner applied another actor plan';
 ASSERT auth.uid()='ba3e052f-27d5-4da5-b832-0b5d9cecbf2f'::uuid,'probe leaked foreign identity';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='0f56388a-c47f-48fd-970a-4f5589627d4b');
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p);
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
SELECT 'D2_789_844_NATIVE_PREVIEW_SESSION_SEAT_LOCK_AND_CANONICAL_SEED_CORRECTION_STALE_DENIAL_SAME_PLAN_POSITIVE_ALL_ROLLBACK_PASS';
