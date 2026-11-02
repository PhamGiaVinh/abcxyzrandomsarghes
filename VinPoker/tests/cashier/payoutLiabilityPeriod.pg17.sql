-- Exact local runner only. Read-boundary fixture metadata; all rows roll back.
BEGIN;
SET LOCAL TIME ZONE 'America/Los_Angeles';
DO $$DECLARE
 owner_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); club uuid:=gen_random_uuid();
 before_id uuid:=gen_random_uuid(); start_id uuid:=gen_random_uuid(); end_id uuid:=gen_random_uuid(); after_id uuid:=gen_random_uuid();
 report jsonb; legacy jsonb; ids uuid[];
BEGIN
 IF (current_database()<>'vinpoker_ops_cash115_qualified_c' AND
   (current_database()!~'^vinpoker_ops_payout124_clean_[a-f0-9]{8}$'
     OR current_setting('test.payout_clone',true) IS DISTINCT FROM current_database()))
   OR inet_server_addr()<>'127.0.0.1'::inet
   OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'isolated_payout_period_fixture_required'; END IF;
 INSERT INTO auth.users(id) VALUES(owner_id),(outsider);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Payout period local TEST','TEST','approved');
 INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level,start_time) VALUES
 (before_id,club,'Period before TEST','live','registering',1,'2026-10-16T23:59:59.999999+07'),
 (start_id,club,'Period start TEST','live','registering',1,'2026-10-17T00:00:00+07'),
 (end_id,club,'Period last microsecond TEST','live','registering',1,'2026-10-17T23:59:59.999999+07'),
 (after_id,club,'Period after TEST','live','registering',1,'2026-10-18T00:00:00+07');
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true);
 PERFORM set_config('role','authenticated',true);
 report:=public.get_club_payout_liability_v2('2026-10-17','2026-10-17',club);
 SELECT array_agg((x->>'tournamentId')::uuid ORDER BY x->>'tournamentId') INTO ids FROM jsonb_array_elements(report->'perTournament') x;
 IF cardinality(ids)<>2 OR NOT start_id=ANY(ids) OR NOT end_id=ANY(ids)
 THEN RAISE EXCEPTION 'business_period_boundary_mismatch: %',report; END IF;
 IF (report->>'periodFrom')::timestamptz<>'2026-10-17T00:00:00+07'::timestamptz
 OR (report->>'periodTo')::timestamptz<>'2026-10-18T00:00:00+07'::timestamptz
 OR report->>'periodEndExclusive'<>'true' OR report->>'clubId'<>club::text
 THEN RAISE EXCEPTION 'business_period_contract_mismatch'; END IF;
 legacy:=public.get_club_payout_liability('2026-10-17T00:00:00+07','2026-10-17T23:59:59.999999+07',club);
 IF report->'perTournament' IS DISTINCT FROM legacy->'perTournament'
 OR report->'owedTotal' IS DISTINCT FROM legacy->'owedTotal'
 OR report->'paidTotal' IS DISTINCT FROM legacy->'paidTotal'
 OR report->'outstandingTotal' IS DISTINCT FROM legacy->'outstandingTotal'
 OR report->'aging' IS DISTINCT FROM legacy->'aging'
 THEN RAISE EXCEPTION 'business_period_changed_financial_derivation'; END IF;
 report:=public.get_club_payout_liability_v2('2026-12-31','2026-12-31',club);
 IF (report->>'periodFrom')::timestamptz<>'2026-12-31T00:00:00+07'::timestamptz
 OR (report->>'periodTo')::timestamptz<>'2027-01-01T00:00:00+07'::timestamptz
 THEN RAISE EXCEPTION 'business_period_year_rollover'; END IF;
 report:=public.get_club_payout_liability_v2('2026-10-01','2026-10-01',club);
 IF (report->>'periodFrom')::timestamptz<>'2026-10-01T00:00:00+07'::timestamptz
 OR (report->>'periodTo')::timestamptz<>'2026-10-02T00:00:00+07'::timestamptz
 THEN RAISE EXCEPTION 'business_period_month_start'; END IF;
 BEGIN
  PERFORM public.get_club_payout_liability_v2('2026-10-18','2026-10-17',club);
  RAISE EXCEPTION 'reversed_dates_not_rejected';
 EXCEPTION WHEN SQLSTATE '22007' THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',outsider)::text,true);
 BEGIN
  PERFORM public.get_club_payout_liability_v2('2026-10-17','2026-10-17',club);
  RAISE EXCEPTION 'outside_club_not_rejected';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF has_function_privilege('anon','public.get_club_payout_liability_v2(date,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.get_club_payout_liability_v2(date,date,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'business_period_acl'; END IF;
END;$$;
ROLLBACK;
SELECT 'PAYOUT125_UTC7_MICROSECOND_BOUNDARY_SCOPE_UNCHANGED_MATH_PASS';
