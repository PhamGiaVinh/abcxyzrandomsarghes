BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND period_year=2099 AND period_month=10),'receipt canary month occupied';
 ASSERT NOT has_table_privilege('authenticated','floor_private.payroll_save_receipts_v2','SELECT');
 ASSERT NOT has_function_privilege('anon','public.get_payroll_save_receipt_v2(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.cancel_unresolved_payroll_save_v2(uuid,uuid,integer,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.cancel_unresolved_payroll_save_v2(uuid,uuid,integer,integer)','EXECUTE');
END $$;
CREATE FUNCTION pg_temp.payroll_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.payroll_receipt_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_RECEIPT_INSERT_FAULT' USING ERRCODE='ZX002';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER local_payroll_receipt_fault BEFORE INSERT ON floor_private.payroll_save_receipts_v2 FOR EACH ROW EXECUTE FUNCTION pg_temp.payroll_receipt_fault();
SELECT set_config('request.jwt.claim.sub','065801a0-565e-4bd6-9c2d-ee252b7e6494',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE roster jsonb;request uuid:=gen_random_uuid();cancelled_request uuid:=gen_random_uuid();first jsonb;again jsonb;denied boolean:=false;other_actor uuid:=gen_random_uuid();BEGIN
 SELECT jsonb_agg(value ORDER BY key) INTO roster FROM jsonb_each(public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2099-10-01','2099-10-31')->'dealers');
 again:=public.cancel_unresolved_payroll_save_v2(cancelled_request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10);
 ASSERT again->>'outcome'='cancelled' AND again->>'requestId'=cancelled_request::text,'unresolved request was not cancelled';
 ASSERT public.get_payroll_save_receipt_v2(cancelled_request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f')=again,'cancellation receipt missing';
 BEGIN
   PERFORM public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31',roster,cancelled_request);
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_request_payload_conflict' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'late cancelled request wrote payroll';denied:=false;
 PERFORM set_config('test.payroll_receipt_fault','on',true);
 BEGIN
   PERFORM public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31',roster,request);
   RAISE EXCEPTION 'receipt fault did not fire';
 EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;END;
 PERFORM set_config('test.payroll_receipt_fault','off',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND period_year=2099 AND period_month=10),'receipt fault left a partial period';
 ASSERT public.get_payroll_save_receipt_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f') IS NULL,'receipt fault left a partial receipt';
 first:=public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31',roster,request);
 ASSERT first->>'outcome'='saved' AND first->>'requestId'=request::text,'save receipt invalid';
 ASSERT public.get_payroll_save_receipt_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f')=first,'lost response lookup did not match';
 ASSERT public.cancel_unresolved_payroll_save_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10)=first,'cancel rewrote a committed save';
 ASSERT public.transition_payroll_status_secure((first->>'periodId')::uuid,'draft','submitted',NULL),'submit failed';
 again:=public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31',roster,request);
 ASSERT again=first,'committed response replay changed after submit';
 PERFORM set_config('role','none',true);
 INSERT INTO auth.users(id) VALUES(other_actor);
 INSERT INTO public.club_accountants(club_id,user_id) VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',other_actor);
 PERFORM set_config('request.jwt.claim.sub',other_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other_actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 ASSERT public.get_payroll_save_receipt_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f') IS NULL,'another authorized actor read owner receipt';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31',roster,request);
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_period_not_editable' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'another actor adopted owner committed request';
 ASSERT public.cancel_unresolved_payroll_save_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10)->>'outcome'='cancelled','other actor cancellation was not scoped separately';
 PERFORM set_config('request.jwt.claim.sub','065801a0-565e-4bd6-9c2d-ee252b7e6494',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}',true);
 ASSERT public.get_payroll_save_receipt_v2(request,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f')=first,'other actor cancellation changed owner receipt';
 denied:=false;
 BEGIN
   PERFORM public.save_payroll_period_v2('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',2099,10,'2099-10-01','2099-10-31','[]',request);
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'payroll_request_payload_conflict' THEN RAISE;END IF;denied:=true;END;
 ASSERT denied,'same key different payload accepted';
END $$;
RESET ROLE;
ROLLBACK;
\echo PAYROLL_DURABLE_RECEIPT_REPLAY_AFTER_SUBMIT_CONFLICT_ROLLBACK_PASS
