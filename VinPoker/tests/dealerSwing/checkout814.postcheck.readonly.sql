\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE m jsonb;p jsonb;att public.dealer_attendance;f record;
BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000289');
 FOR f IN SELECT * FROM(VALUES
  ('public.get_dealer_checkout_receipt_v1(uuid,uuid)'::regprocedure,'3884d303dd6f80562ad5619a55a8bcbb'),
  ('public.operator_checkout_dealer_attendance_v1(uuid,uuid)'::regprocedure,'67112d4602462f5dcca6d59e99613068'))x(oid,body_hash) LOOP
  ASSERT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f.oid AND md5(prosrc)=f.body_hash AND prosecdef AND proconfig=ARRAY['search_path=""']);
  ASSERT NOT has_function_privilege('anon',f.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE');
  ASSERT has_function_privilege('service_role',f.oid,'EXECUTE');
 END LOOP;
 ASSERT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN('private.checkout814_fixture'::regclass,'private.dealer_checkout_receipts_v1'::regclass));
 ASSERT NOT has_table_privilege('anon','private.dealer_checkout_receipts_v1','SELECT')
  AND NOT has_table_privilege('authenticated','private.dealer_checkout_receipts_v1','SELECT')
  AND NOT has_table_privilege('service_role','private.dealer_checkout_receipts_v1','SELECT');
 SELECT manifest,proof INTO STRICT m,p FROM private.checkout814_fixture WHERE id;
 ASSERT m->>'source_head'='ef6a26948' AND (p->>'barrier_observed')::boolean;
 ASSERT p->'replay'=(p->'first')||jsonb_build_object('idempotent',true);
 SELECT * INTO STRICT att FROM public.dealer_attendance WHERE id=(m->>'attendance')::uuid;
 ASSERT att.status='checked_out' AND att.current_state='checked_out' AND att.check_out_time=(p#>>'{first,check_out_time}')::timestamptz;
 ASSERT att.total_worked_minutes_today=540 AND att.overtime_minutes=60;
 ASSERT (SELECT count(*)=1 AND bool_and(actor_id=(m->>'actor')::uuid AND result=p->'first'
   AND attendance_facts=jsonb_build_array(att.dealer_id,att.status,att.current_state,att.check_in_time,att.check_out_time,
     att.total_worked_minutes_today,att.overtime_minutes,att.pre_assigned_table_id,att.pre_assigned_at))
   FROM private.dealer_checkout_receipts_v1 WHERE attendance_id=att.id);
 ASSERT (SELECT count(*)=1 AND bool_and(actor_id=(m->>'actor')::uuid AND payload->>'worked_minutes'='540' AND payload->>'overtime_minutes'='60')
   FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text=att.id::text);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(m->>'assignment')::uuid AND attendance_id=att.id AND status='completed' AND released_at IS NOT NULL);
 ASSERT jsonb_array_length(p#>'{close815,orders}')=2
  AND (SELECT bool_and((x->>'barrier_observed')::boolean AND (x->>'business_rolled_back')::boolean) FROM jsonb_array_elements(p#>'{close815,orders}')x);
 SELECT * INTO STRICT att FROM public.dealer_attendance WHERE id=(m#>>'{close815,attendance}')::uuid;
 ASSERT att.status='checked_in' AND att.current_state='assigned' AND att.check_out_time IS NULL AND att.total_worked_minutes_today=0 AND att.overtime_minutes=0;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id=att.id AND table_session_id=(m->>'session')::uuid AND status='assigned' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=(m->>'session')::uuid AND closed_at IS NULL AND revision=(m#>>'{close815,revision}')::bigint);
 ASSERT NOT EXISTS(SELECT 1 FROM private.dealer_checkout_receipts_v1 WHERE attendance_id=att.id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text=att.id::text);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt((m->>'actor')::uuid,'close_tournament_table_v3',(m#>>'{close815,close_request}')::uuid));
 ASSERT jsonb_array_length(p#>'{revoke816,orders}')=2
  AND (SELECT bool_and((x->>'barrier_observed')::boolean AND (x->>'checkout_rolled_back')::boolean) FROM jsonb_array_elements(p#>'{revoke816,orders}')x);
 ASSERT p#>'{revoke816,after_revocation}'='{"data":null,"code":"42501","error":"DEALER_CHECKOUT_FORBIDDEN"}'::jsonb;
 ASSERT NOT public.is_club_dealer_control((m#>>'{revoke816,actor}')::uuid,(m->>'club')::uuid);
 ASSERT public.is_club_dealer_control((m->>'actor')::uuid,(m->>'club')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE club_id=(m->>'club')::uuid AND user_id=(m#>>'{revoke816,actor}')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=(m->>'tournament')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=(m->>'tournament')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id=(m->>'club')::uuid AND auto_swing_enabled);
END $$;
SELECT 'CHECKOUT814_816_DURABLE_RECEIPT_SINGLE_WRITE_LOCK_PROOFS_ROLLBACK_CLOSE_PERMISSION_DENIAL_ACL_AUTO_OFF_PASS';
ROLLBACK;
