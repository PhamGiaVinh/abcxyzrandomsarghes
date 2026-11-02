\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE m jsonb;p jsonb;a public.dealer_attendance;host public.dealer_assignments;r jsonb;worked integer;
BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 SELECT manifest,proof INTO STRICT m,p FROM private.checkout817_fixture WHERE id;
 ASSERT m->>'actor'='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND m->>'club'='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 ASSERT p->>'model'='AUTH_POSTGREST_MODELED_REAL_SDK_HTTP_ACTUAL_EDGE_HANDLER_CANONICAL_PG_COMMIT';
 ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(p->'events')e WHERE e->>'fault'='CORE_SUCCESS_RESPONSE_LOST_AFTER_COMMIT');
 ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(p->'events')e WHERE e->>'service_rpc'='operator_checkout_dealer_attendance_v1' AND e#>>'{result,success}'='true');
 ASSERT (SELECT count(*)=1 FROM jsonb_array_elements(p->'events')e WHERE e->>'edge'='checkout-dealer' AND e->>'status'='200'
  AND e#>>'{result,results,0,success}'='true' AND e#>>'{result,results,0,recovered}'='true');
 SELECT * INTO STRICT a FROM public.dealer_attendance WHERE id=(m->>'attendance')::uuid;
 worked:=round(extract(epoch FROM(a.check_out_time-a.check_in_time))/60)::integer;
 ASSERT a.status='checked_out' AND a.current_state='checked_out' AND a.pre_assigned_table_id IS NULL AND a.pre_assigned_at IS NULL;
 ASSERT a.total_worked_minutes_today=worked AND a.overtime_minutes=greatest(0,worked-480);
 SELECT result INTO STRICT r FROM private.dealer_checkout_receipts_v1 WHERE attendance_id=a.id;
 ASSERT r->>'attendance_id'=a.id::text AND r->>'released_pre_assigned'='true';
 ASSERT r->'released_assignment_ids'='[]'::jsonb AND r->'cleared_preassignment_assignment_ids'=jsonb_build_array(m->>'host_assignment');
 ASSERT r->'replacement_table_id'='null'::jsonb AND r->'replacement_session_id'='null'::jsonb AND r->'replacement_assignment_id'='null'::jsonb;
 ASSERT (r->>'total_hours')::numeric=round(worked::numeric/6)/10;
 ASSERT (SELECT count(*)=1 AND bool_and(actor_id=(m->>'actor')::uuid AND payload->>'worked_minutes'=worked::text)
  FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text=a.id::text);
 SELECT * INTO STRICT host FROM public.dealer_assignments WHERE id=(m->>'host_assignment')::uuid;
 ASSERT host.status='assigned' AND host.released_at IS NULL AND host.pre_assigned_attendance_id IS NULL AND host.pre_assigned_at IS NULL;
 -- Reserving then clearing the pointer legitimately advances the row's CAS
 -- version twice; the incumbent identity/session/status must not change.
 ASSERT to_jsonb(host)-'version'-'updated_at'=(m->'host_before')-'version'-'updated_at';
 ASSERT host.version=(m#>>'{host_before,version}')::bigint+2;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id=a.id AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=(m->>'tour')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=(m->>'tour')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id=(m->>'club')::uuid AND auto_swing_enabled);
END $$;
SELECT 'CHECKOUT817_BROWSER_HTTP_RESPONSE_LOSS_ONE_RECEIPT_ONE_AUDIT_FROZEN_HOURS_OTHER_DEALER_NOT_RELEASED_PASS';
ROLLBACK;
