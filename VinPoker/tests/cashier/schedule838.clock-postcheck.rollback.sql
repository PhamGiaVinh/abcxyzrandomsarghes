\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';
DO $$ DECLARE b record;t jsonb;BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM private.schedule838_fixture WHERE id;
 ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY id)::text,'null')) FROM public.tournaments x WHERE id<>'ba18ce1f-5993-44be-a6df-4772c4b96239')=b.other_tours_hash;
 SELECT to_jsonb(x) INTO STRICT t FROM public.tournaments x WHERE id='ba18ce1f-5993-44be-a6df-4772c4b96239';
 ASSERT t->>'status'='live' AND t->>'current_level'='1' AND t->>'clock_paused_at' IS NOT NULL AND t->>'clock_started_at' IS NOT NULL;
 ASSERT (t->>'clock_control_revision')::integer=(b.original_tour->>'clock_control_revision')::integer+4,'four real clock controls must bump the stored revision';
 ASSERT (t-ARRAY['status','current_level','clock_started_at','clock_paused_at','pause_accumulated','clock_control_revision','updated_at'])=
  (b.original_tour-ARRAY['status','current_level','clock_started_at','clock_paused_at','pause_accumulated','clock_control_revision','updated_at']),'unrelated tournament fields changed';
 ASSERT (SELECT count(*) FROM public.tournament_levels WHERE tournament_id='ba18ce1f-5993-44be-a6df-4772c4b96239')=1;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id='ba18ce1f-5993-44be-a6df-4772c4b96239'
  AND level_number=1 AND small_blind=100 AND big_blind=200 AND ante=0 AND duration_minutes=20 AND is_break=false);
 ASSERT (SELECT count(*) FROM public.audit_logs WHERE entity_id::text='ba18ce1f-5993-44be-a6df-4772c4b96239' AND action='floor_tournament_clock_started')=1;
 ASSERT (SELECT count(*) FROM public.audit_logs WHERE entity_id::text='ba18ce1f-5993-44be-a6df-4772c4b96239' AND action='floor_tournament_clock_controlled')=3;
 ASSERT (SELECT count(*) FROM public.tournament_state_transitions WHERE tournament_id='ba18ce1f-5993-44be-a6df-4772c4b96239' AND new_state='live')=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='ba18ce1f-5993-44be-a6df-4772c4b96239');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='ba18ce1f-5993-44be-a6df-4772c4b96239');
END $$;
CREATE TEMP TABLE clock838_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_logs t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.tournament_state_transitions t)
)::text) hash;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.get_tournament_clock('ba18ce1f-5993-44be-a6df-4772c4b96239');
 ASSERT r->>'is_running'='false' AND r->>'remaining_seconds'='837' AND r->>'control_revision'='16952b83b4611a4a2954e553b27d2d11',r::text;
 r:=public.floor_start_tournament_clock('ba18ce1f-5993-44be-a6df-4772c4b96239');ASSERT r->>'error'='clock_already_started',r::text;
 r:=public.floor_control_tournament_clock('ba18ce1f-5993-44be-a6df-4772c4b96239','resume',NULL,'56870300200c3fb21d37b289f0ebb602');
 ASSERT r->>'error'='stale_clock_state',r::text;
 r:=public.floor_control_tournament_clock('ba18ce1f-5993-44be-a6df-4772c4b96239','pause',NULL,'16952b83b4611a4a2954e553b27d2d11');
 ASSERT r->>'outcome'='clock_already_paused' AND r->>'changed'='false',r::text;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.floor_control_tournament_clock('ba18ce1f-5993-44be-a6df-4772c4b96239','resume',NULL,'16952b83b4611a4a2954e553b27d2d11');
 ASSERT r->>'error'='actor_not_allowed',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.audit_logs t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.tournament_state_transitions t)
 )::text)=hash FROM clock838_before);
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
ROLLBACK;
SELECT 'SCHEDULE838_IMPORTED_BLIND_CLOCK_START_PAUSE_RESUME_PAUSE_AUDIT_CAS_TENANT_NO_DELTA_PASS';
