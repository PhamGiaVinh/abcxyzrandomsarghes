\set ON_ERROR_STOP on
-- Execute inside the caller's transaction AFTER candidate223; caller ROLLBACKs.
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT to_regprocedure('public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)') IS NOT NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN('e2710000-0000-4000-8000-000000000001','e2710000-0000-4000-8000-000000000002'));
END $guard$;
INSERT INTO auth.users(id) VALUES('e2710000-0000-4000-8000-000000000001'),('e2710000-0000-4000-8000-000000000002');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e2710000-0000-4000-8000-000000000010','e2710000-0000-4000-8000-000000000001','Bank receipt271 rollback TEST','TEST');
INSERT INTO public.club_chip_masters(club_id,user_id) VALUES('e2710000-0000-4000-8000-000000000010','e2710000-0000-4000-8000-000000000002');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('e2710000-0000-4000-8000-000000000020','e2710000-0000-4000-8000-000000000010','Bank receipt271 rollback TEST','live','playing');
INSERT INTO public.chip_set(id,club_id,name) VALUES('e2710000-0000-4000-8000-000000000030','e2710000-0000-4000-8000-000000000010','Bank receipt271 rollback TEST');
INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('e2710000-0000-4000-8000-000000000040','e2710000-0000-4000-8000-000000000030','e2710000-0000-4000-8000-000000000010',100);
INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('e2710000-0000-4000-8000-000000000041','e2710000-0000-4000-8000-000000000030','e2710000-0000-4000-8000-000000000010',500);
SELECT set_config('request.jwt.claim.sub','e2710000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"e2710000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Model an already committed v1 ledger entry without manufacturing a v2 receipt.
SELECT floor_private.chip_bank_adjust_primitive_v1('e2710000-0000-4000-8000-000000000010','e2710000-0000-4000-8000-000000000041','thu',3,'e2710000-0000-4000-8000-000000000020',0,'bank271-prior-legacy');
SET LOCAL ROLE authenticated;
DO $cases$
DECLARE c uuid:='e2710000-0000-4000-8000-000000000010';d uuid:='e2710000-0000-4000-8000-000000000040';t uuid:='e2710000-0000-4000-8000-000000000020';a uuid:=auth.uid();r jsonb;again jsonb;
BEGIN
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,'e2710000-0000-4000-8000-000000000041','thu',3,t,0,'bank271-prior-legacy',a)->>'outcome'='applied';
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,d,'thu',12,t,0,'bank271-original',a) IS NULL,'missing receipt is unknown, not a rejection';
 BEGIN
  PERFORM public.chip_ops_bank_adjust_v2(c,d,'thu',12,t,0,'bank271-wrong-expected','e2710000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'expected actor guard missing';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=public.chip_ops_bank_adjust_v2(c,d,'thu',12,t,0,'bank271-original',a);
 ASSERT r->>'status'='ok' AND r->>'outcome'='applied' AND r->>'actor_id'=a::text AND r->>'request_id'='bank271-original';
 ASSERT r->'payload'=jsonb_build_object('club_id',c,'denomination_id',d,'direction','thu','count',12,'tournament_id',t,'expected_version',0);
 ASSERT r->>'ledger_id' IS NOT NULL AND (r->'result'->>'balance_after')::bigint=12;
 again:=public.get_chip_bank_adjust_receipt_v2(c,d,'thu',12,t,0,'bank271-original',a);
 ASSERT again-'idempotent'=r-'idempotent','read after response loss returns original evidence';
 again:=public.chip_ops_bank_adjust_v2(c,d,'thu',12,t,0,'bank271-original',a);
 ASSERT again-'idempotent'=r-'idempotent';
 ASSERT public.chip_ops_bank_adjust(c,d,'thu',12,t,0,'bank271-original')->>'idempotent'='true','legacy retry uses same receipt';
 ASSERT public.chip_ops_bank_adjust_v2(c,d,'thu',13,t,0,'bank271-original',a)->>'error'='IDEMPOTENCY_CONFLICT';
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,d,'xuat',12,t,0,'bank271-original',a)->>'error'='IDEMPOTENCY_CONFLICT';
 r:=public.chip_ops_bank_adjust_v2(c,d,'xuat',13,t,1,'bank271-rejected',a);
 ASSERT r->>'outcome'='rejected' AND r->>'error'='BANK_NEGATIVE' AND r->'ledger_id'='null'::jsonb;
 ASSERT public.chip_ops_bank_adjust(c,d,'thu',1,t,1,'bank271-legacy-new')->>'status'='ok';
 again:=public.chip_ops_bank_adjust_v2(c,d,'xuat',13,t,1,'bank271-rejected',a);
 ASSERT again-'idempotent'=r-'idempotent','reject remains immutable even after stock changes';
 ASSERT public.chip_ops_bank_adjust(c,d,'xuat',13,t,1,'bank271-rejected')->>'error'='BANK_NEGATIVE','legacy exact retry keeps original rejection';
 ASSERT public.chip_ops_bank_adjust(c,d,'xuat',13,t,2,'bank271-rejected')->>'error'='IDEMPOTENCY_CONFLICT','legacy cannot bypass rejected payload';
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,d,'thu',1,t,1,'bank271-legacy-new',a)->>'outcome'='applied';
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,d,'xuat',13,t,1,'bank271-rejected',a)-'idempotent'=r-'idempotent';
 ASSERT public.get_chip_bank_adjust_receipt_v2('e2710000-0000-4000-8000-000000000099',d,'thu',12,t,0,'bank271-original',a)->>'error'='Forbidden';
 ASSERT public.chip_ops_bank_adjust(c,d,'thu',1,t,NULL,'bank271-null-version')->>'error'='INVALID_INPUT';
END $cases$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e2710000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e2710000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $other$ DECLARE c uuid:='e2710000-0000-4000-8000-000000000010';d uuid:='e2710000-0000-4000-8000-000000000040';t uuid:='e2710000-0000-4000-8000-000000000020';BEGIN
 ASSERT public.is_club_chip_master(auth.uid(),c);
 ASSERT public.get_chip_bank_adjust_receipt_v2(c,d,'thu',12,t,0,'bank271-original',auth.uid())->>'error'='IDEMPOTENCY_CONFLICT';
 ASSERT public.chip_ops_bank_adjust_v2(c,d,'thu',12,t,0,'bank271-original',auth.uid())->>'error'='IDEMPOTENCY_CONFLICT';
 BEGIN
  PERFORM public.chip_ops_bank_adjust_v2(c,d,'thu',100,t,2,'bank271-first-dispatch','e2710000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'first-dispatch expected-actor guard missing';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $other$;
RESET ROLE;
CREATE FUNCTION pg_temp.bank271_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN IF NEW.request_key='bank271-fault' THEN RAISE EXCEPTION 'BANK271_FAULT' USING ERRCODE='P0002';END IF;RETURN NEW;END $f$;
CREATE TRIGGER bank271_fault BEFORE INSERT ON floor_private.chip_mutation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.bank271_fail_receipt();
SELECT set_config('request.jwt.claim.sub','e2710000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e2710000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $fault$ BEGIN
 BEGIN
  PERFORM public.chip_ops_bank_adjust_v2('e2710000-0000-4000-8000-000000000010','e2710000-0000-4000-8000-000000000040','thu',9,'e2710000-0000-4000-8000-000000000020',2,'bank271-fault',auth.uid());
  RAISE EXCEPTION 'fault not reached';
 EXCEPTION WHEN no_data_found THEN NULL;END;
END $fault$;
RESET ROLE;
DO $facts$ BEGIN
 ASSERT (SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='e2710000-0000-4000-8000-000000000010')=3;
 ASSERT EXISTS(SELECT 1 FROM public.chip_bank WHERE club_id='e2710000-0000-4000-8000-000000000010' AND on_hand_count=13 AND version=2);
 ASSERT (SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE actor_id='e2710000-0000-4000-8000-000000000001')=3;
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.chip_mutation_receipts WHERE request_key='bank271-prior-legacy'),'legacy lookup is read-only';
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bank_ledger WHERE idempotency_key IN('bank271-wrong-expected','bank271-first-dispatch','bank271-fault'));
 ASSERT NOT has_function_privilege('authenticated','floor_private.chip_bank_adjust_primitive_v1(uuid,uuid,text,bigint,uuid,integer,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','floor_private.chip_mutation_receipts','SELECT');
END $facts$;
SELECT 'BANK271_EXPECTED_ACTOR_RECEIPT_REJECT_LEGACY_FAULT_NATIVE_PASS';
