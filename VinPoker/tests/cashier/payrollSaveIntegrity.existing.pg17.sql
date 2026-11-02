-- Never production. Forged save is always rolled back, including on assertion failure.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND period_year=2026 AND period_month=9),'isolated test period already occupied';
END $$;
SELECT set_config('request.jwt.claim.sub','065801a0-565e-4bd6-9c2d-ee252b7e6494',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE canonical jsonb; forged jsonb; denied boolean:=false; period uuid; fresh jsonb; source jsonb; roster jsonb; forged_roster jsonb;
BEGIN
 source:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-09-01','2026-09-30')->'dealers';
 canonical:=source->'0d617281-35e5-43cc-87f2-86e5094bc403';
 SELECT jsonb_agg(value ORDER BY key) INTO roster FROM jsonb_each(source);
 ASSERT canonical->>'dealer_id'='0d617281-35e5-43cc-87f2-86e5094bc403','canonical payroll fixture missing';
 forged:=canonical||jsonb_build_object('gross_pay_vnd',987654321,'net_pay_vnd',987654321,'net_pay_after_tax_vnd',987654321);
 SELECT jsonb_agg(CASE WHEN key='0d617281-35e5-43cc-87f2-86e5094bc403' THEN forged ELSE value END ORDER BY key)
 INTO forged_roster FROM jsonb_each(source);
 BEGIN
   PERFORM public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',forged_roster);
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_source_changed_refresh_required' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'PAYROLL_CLIENT_AMOUNT_TAMPER_ACCEPTED';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-02','2026-09-30',roster);
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_period_dates_mismatch' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'payroll date/month mismatch accepted';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',jsonb_build_array(canonical,canonical));
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 ASSERT denied,'duplicate dealer roster accepted';
 PERFORM set_config('role','service_role',true);denied:=false;
 BEGIN
   PERFORM public.save_payroll_period('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',jsonb_build_array(canonical),'50e5437a-9b82-4b60-8f70-dac066deecc9');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'legacy service actor impersonation accepted';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',forged_roster,'065801a0-565e-4bd6-9c2d-ee252b7e6494');
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_source_changed_refresh_required' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'legacy service accepted forged amounts';
 PERFORM set_config('role','authenticated',true);
 period:=public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',roster);
 ASSERT period IS NOT NULL,'canonical save did not return a period';
 ASSERT EXISTS(SELECT 1 FROM public.dealer_payroll dp WHERE dp.period_id=period AND dp.dealer_id='0d617281-35e5-43cc-87f2-86e5094bc403'
   AND dp.gross_pay_vnd IS NOT DISTINCT FROM (canonical->>'gross_pay_vnd')::numeric
   AND dp.net_pay_vnd IS NOT DISTINCT FROM (canonical->>'net_pay_vnd')::numeric),'canonical payroll amounts changed';
 source:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-09-01','2026-09-30')->'dealers';
 SELECT jsonb_agg(value ORDER BY key) INTO fresh FROM jsonb_each(source);
 ASSERT public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',fresh)=period,'canonical repeat created a second period';
 ASSERT public.transition_payroll_status_secure(period,'draft','submitted',NULL),'canonical submit failed';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,9,'2026-09-01','2026-09-30',fresh);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 ASSERT denied,'submitted payroll was overwritten';
END $$;
RESET ROLE;
ROLLBACK;
\echo PAYROLL_FORGED_CLIENT_AMOUNTS_REJECTED_ROLLBACK_PASS

BEGIN;
DO $$ DECLARE actor uuid:=gen_random_uuid();roster jsonb;period uuid;denied boolean:=false;BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND period_year=2026 AND period_month=8),'accountant fixture month occupied';
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.club_accountants(club_id,user_id) VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 SELECT jsonb_agg(value ORDER BY key) INTO roster FROM jsonb_each(public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-08-01','2026-08-31')->'dealers');
 ASSERT jsonb_array_length(roster)>0,'accountant canonical roster absent';
 period:=public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2026,8,'2026-08-01','2026-08-31',roster);
 ASSERT period IS NOT NULL,'accountant draft save rejected';
 BEGIN
   PERFORM public.save_payroll_period_secure('12ac8914-4a94-4f29-99d6-a74a506c134e',2026,8,'2026-08-01','2026-08-31',roster);
 EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
   IF SQLERRM NOT LIKE 'Actor is not authorized for payroll club %' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'accountant crossed club scope';
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.payroll_periods WHERE id=period AND status='draft'),'accountant save finalized a period';
END $$;
ROLLBACK;
\echo PAYROLL_ACCOUNTANT_CANONICAL_DRAFT_AND_CROSS_CLUB_DENIAL_PASS

BEGIN;
SELECT set_config('request.jwt.claim.sub','065801a0-565e-4bd6-9c2d-ee252b7e6494',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE target_year int;roster jsonb;period uuid;BEGIN
 FOREACH target_year IN ARRAY ARRAY[1999,2201] LOOP
   ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND period_year=target_year AND period_month=9),'year boundary fixture occupied';
   SELECT jsonb_agg(value ORDER BY key) INTO roster FROM jsonb_each(public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',make_date(target_year,9,1),make_date(target_year,9,30))->'dealers');
   period:=public.save_payroll_period_secure('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',target_year,9,make_date(target_year,9,1),make_date(target_year,9,30),roster);
   ASSERT period IS NOT NULL,'valid PostgreSQL calendar year blocked';
 END LOOP;
END $$;
RESET ROLE;
ROLLBACK;
\echo PAYROLL_NO_NEW_HISTORICAL_YEAR_POLICY_ROLLBACK_PASS
