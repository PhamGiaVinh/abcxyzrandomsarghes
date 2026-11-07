\set ON_ERROR_STOP on
-- Actual PostgreSQL statement timeout/canonical functions, entirely rolled
-- back. Not verified-player Edge HTTP or a committed payment acceptance case.
BEGIN;
SET LOCAL statement_timeout='5s';
DO $$ DECLARE target record;session_row record;owner_id uuid;result jsonb; BEGIN
 IF current_database()<>'postgres'
  OR to_regclass('ops_reentry_transport_probe_v1.bank_probe_before') IS NULL
  OR NOT EXISTS(SELECT 1 FROM ops_reentry_transport_probe_v1.bank_probe_before WHERE singleton)
  OR (SELECT is_called FROM ops_reentry_transport_probe_v1.notification_timeout_attempts)
  OR (SELECT snapshot FROM ops_reentry_transport_probe_v1.bank_probe_before WHERE singleton)
    IS DISTINCT FROM ops_reentry_transport_probe_v1.bank_probe_source_snapshot() THEN
  RAISE EXCEPTION 'isolated_notification_timeout_fixture_required';
 END IF;
 SELECT c.owner_id INTO STRICT owner_id FROM public.clubs c
  WHERE c.id='a2000000-0000-4000-8000-000000000001' AND c.name='Cashier Edge TEST';
 SELECT e.id,e.player_id,s.table_session_id,s.chip_count INTO STRICT target
  FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
  JOIN public.club_cashiers c ON c.user_id=e.player_id AND c.club_id='a2000000-0000-4000-8000-000000000001'
  WHERE e.tournament_id='a3000000-0000-4000-8000-000000000001' AND e.entry_no=1 AND e.status='seated'
   AND e.player_id<>owner_id ORDER BY e.player_id LIMIT 1;
 SELECT * INTO STRICT session_row FROM public.table_sessions WHERE id=target.table_session_id AND closed_at IS NULL AND control_mode='manual';
 IF target.chip_count<>20000 THEN RAISE EXCEPTION 'notification_timeout_source_stack_changed';END IF;
 PERFORM set_config('test.reentry_timeout_player',target.player_id::text,true);
 PERFORM set_config('test.reentry_timeout_source_entry',target.id::text,true);
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_bust_player_v3(target.id,session_row.revision,session_row.control_epoch,20000,gen_random_uuid(),'isolated_notification_timeout_TEST');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'notification_timeout_canonical_bust_failed';END IF;
 PERFORM set_config('role','none',true);
END $$;
UPDATE ops_reentry_transport_probe_v1.timeout_mode SET enabled=true WHERE singleton;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
SET LOCAL statement_timeout='300ms';
DO $$ DECLARE result jsonb;started timestamptz:=clock_timestamp();elapsed_ms numeric;BEGIN
 result:=public.cashier_app_reentry_transport_v1('a3000000-0000-4000-8000-000000000001',current_setting('test.reentry_timeout_player')::uuid);
 elapsed_ms:=extract(epoch FROM clock_timestamp()-started)*1000;
 IF result->>'status' IS DISTINCT FROM '200' OR result->'body'->>'success' IS DISTINCT FROM 'true'
  OR elapsed_ms<150 OR elapsed_ms>3000 OR NOT EXISTS(SELECT 1 FROM public.tournament_registrations r
   WHERE r.id=(result->'body'->>'registration_id')::uuid AND r.status='pending'
    AND r.player_id=current_setting('test.reentry_timeout_player')::uuid
    AND r.source_entry_id=current_setting('test.reentry_timeout_source_entry')::uuid) THEN
  RAISE EXCEPTION 'notification_timeout_lost_pending_registration';
 END IF;
 PERFORM set_config('test.reentry_timeout_elapsed',elapsed_ms::text,true);
END $$;
RESET ROLE;
SET LOCAL statement_timeout='5s';
DO $$ BEGIN
 IF (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ops_reentry_transport_probe_v1.notification_timeout_attempts)<>1 THEN
  RAISE EXCEPTION 'notification_timeout_trigger_not_reached';END IF;
END $$;
SELECT jsonb_build_object('phase','pending-survived-timeout','elapsedMs',current_setting('test.reentry_timeout_elapsed')::numeric,'timeoutAttempts',1);
ROLLBACK;
DO $$ BEGIN
 IF (SELECT snapshot FROM ops_reentry_transport_probe_v1.bank_probe_before WHERE singleton)
  IS DISTINCT FROM ops_reentry_transport_probe_v1.bank_probe_source_snapshot()
  OR (SELECT enabled FROM ops_reentry_transport_probe_v1.timeout_mode WHERE singleton) THEN
  RAISE EXCEPTION 'notification_timeout_outer_rollback_changed_source';END IF;
END $$;
SELECT jsonb_build_object('phase','outer-rollback-preserved-source','sourceUnchanged',true,'modeReset',true);
