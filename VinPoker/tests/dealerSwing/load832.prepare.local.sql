\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT to_regclass('private.load832_fixture') IS NULL,'832 constructor consumed; never reset/reseed';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT (SELECT count(*) FROM public.table_sessions WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND closed_at IS NULL)=2;
END $$;
CREATE TEMP TABLE load832_rows ON COMMIT DROP AS SELECT id physical,table_number,gen_random_uuid() dealer,gen_random_uuid() checkin_request
 FROM public.game_tables WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND (table_number BETWEEN 1 AND 29 OR table_number BETWEEN 32 AND 40);
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM load832_rows)=38;
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions s JOIN load832_rows x ON x.physical=s.game_table_id WHERE s.closed_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.game_tables g JOIN load832_rows x ON x.physical=g.id WHERE g.operational_status IS DISTINCT FROM 'available');
END $$;
CREATE TEMP TABLE load832_original ON COMMIT DROP AS SELECT 'dealer_attendance' kind,to_jsonb(x) row FROM public.dealer_attendance x
 UNION ALL SELECT 'dealer_assignments',to_jsonb(x) FROM public.dealer_assignments x
 UNION ALL SELECT 'table_sessions',to_jsonb(x) FROM public.table_sessions x;
CREATE FUNCTION pg_temp.load832_protected() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_payroll x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payroll_periods x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.club_settings x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.centerpoint_tournament_ops_release x)
 )::text);
$$;
CREATE TEMP TABLE load832_before ON COMMIT DROP AS SELECT pg_temp.load832_protected() hash,gen_random_uuid() open_request;
CREATE TABLE private.load832_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),manifest jsonb NOT NULL,protected_hash text NOT NULL,proof jsonb);
ALTER TABLE private.load832_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.load832_fixture FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.dealers(id,club_id,full_name) SELECT dealer,'d4427834-5f5f-48ef-bde5-e2dc388ed00b','LOCAL832 LOAD TABLE '||table_number||' TEST' FROM load832_rows;
GRANT SELECT ON load832_rows,load832_before TO authenticated;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE x record;r jsonb;BEGIN
 FOR x IN SELECT * FROM load832_rows ORDER BY table_number LOOP
  r:=public.operator_check_in_dealer_v1(x.dealer,'d4427834-5f5f-48ef-bde5-e2dc388ed00b','dc91889f-0f73-4e2c-aaf1-d539a6072aed',x.checkin_request);
  ASSERT r->>'ok'='true' AND r->>'outcome'='checked_in',r::text;
 END LOOP;
 r:=public.operator_open_club_tables_v2((SELECT array_agg(physical ORDER BY physical) FROM load832_rows),'cash',(SELECT open_request FROM load832_before));
 ASSERT r->>'ok'='true' AND jsonb_array_length(r->'sessions')=38,r::text;
END $$;
RESET ROLE;
CREATE TEMP TABLE load832_assign ON COMMIT DROP AS SELECT x.*,s.id session,a.id attendance FROM load832_rows x
 JOIN public.table_sessions s ON s.game_table_id=x.physical AND s.closed_at IS NULL
 JOIN public.dealer_attendance a ON a.dealer_id=x.dealer AND a.status='checked_in' AND a.check_out_time IS NULL;
GRANT SELECT ON load832_assign TO service_role;
SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE service_role;
DO $$ DECLARE x record;r jsonb;BEGIN
 FOR x IN SELECT * FROM load832_assign ORDER BY physical LOOP
  r:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b',x.physical,x.session,x.attendance,statement_timestamp()+interval '30 minutes','LOCAL832-'||x.checkin_request);
  ASSERT r->>'outcome'='ok',r::text;
 END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE original record;current_row jsonb;BEGIN
 ASSERT (SELECT pg_temp.load832_protected()=hash FROM load832_before);
 FOR original IN SELECT * FROM load832_original LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',original.kind) INTO current_row USING (original.row->>'id')::uuid;
  ASSERT current_row=original.row,'832 changed original row in '||original.kind;
 END LOOP;
 ASSERT (SELECT count(*) FROM public.table_sessions WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND closed_at IS NULL)=40;
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND status='assigned' AND released_at IS NULL)=40;
END $$;
INSERT INTO private.load832_fixture(manifest,protected_hash) SELECT jsonb_build_object('head','ef6a26948','club','d4427834-5f5f-48ef-bde5-e2dc388ed00b',
 'actor','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','open_request',b.open_request,'existing_open_tables',2,'new_tables',38,
 'rows',(SELECT jsonb_agg(to_jsonb(x) ORDER BY table_number) FROM load832_assign x)),b.hash FROM load832_before b;
COMMIT;
SELECT 'LOAD832_38_CANONICAL_CHECKINS_OPENS_ASSIGNMENTS_TOTAL40_ORIGINAL_ROWS_AND_FINANCIAL_FACTS_UNCHANGED_PASS';
