-- Diagnostic baseline only: reproduced gap, not feature acceptance.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_overlap_20261014' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464)
 OR (SELECT count(*) FROM public.clubs)<>2
 OR NOT public.is_club_floor('81300000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001')
 OR public.is_club_tracker('81300000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments a JOIN public.dealers d ON d.id=a.dealer_id
  WHERE a.id='88000000-0000-4000-8000-000000000001' AND a.status='assigned' AND a.released_at IS NULL
  AND a.table_session_id='83500000-0000-4000-8000-000000000001'
  AND d.user_id='81200000-0000-4000-8000-000000000001' AND d.status='active')
 THEN RAISE EXCEPTION 'owned_manual75_read_context_baseline_required'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE response jsonb; BEGIN
 response:=public.get_tracker_hand_input_tables_v3('85000000-0000-4000-8000-000000000001');
 IF response->>'ok' IS DISTINCT FROM 'false' OR response->>'error' IS DISTINCT FROM 'actor_not_allowed'
 THEN RAISE EXCEPTION 'floor_read_context_gap_not_reproduced: %',response; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE response jsonb; BEGIN
 response:=public.get_tracker_hand_input_tables_v3('85000000-0000-4000-8000-000000000001');
 IF response->>'ok' IS DISTINCT FROM 'false' OR response->>'error' IS DISTINCT FROM 'actor_not_allowed'
 THEN RAISE EXCEPTION 'assigned_dealer_read_context_gap_not_reproduced: %',response; END IF;
END $$;
ROLLBACK;
\echo MANUAL75_FLOOR_ASSIGNED_DEALER_V3_READ_CONTEXT_GAP_REPRODUCED_NOT_ACCEPTANCE_PASS
