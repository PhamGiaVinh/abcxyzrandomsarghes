\set ON_ERROR_STOP on
-- Full captured schema + native auth.uid(), canonical helpers, existing RPCs.
-- No substitute table/function schema. Run only on the disposable local DB.
-- All fixture rows and calls roll back. Pending migration is applied separately.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
DO $local_only$ BEGIN
 IF current_database() NOT LIKE 'vinpoker_ops_r02_dealer_%'
   OR current_setting('port') <> '5548'
   OR current_setting('data_directory') NOT LIKE '/tmp/vinpoker-%' THEN
  RAISE EXCEPTION 'disposable_local_database_required';
 END IF;
END $local_only$;
CREATE FUNCTION pg_temp.assert_payroll_boundary(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PAYROLL_BOUNDARY: %', message; END IF; END
$fn$;

SELECT pg_temp.assert_payroll_boundary(
  NOT has_table_privilege('anon','public.payroll_periods','SELECT')
  AND NOT has_table_privilege('authenticated','public.payroll_periods','UPDATE'),
  'anonymous reads and direct payroll approval are forbidden');

INSERT INTO auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
SELECT ('17330000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'r02-payroll-'||n||'@example.test','authenticated','authenticated',now(),now(),now()
FROM generate_series(1,8) n;
INSERT INTO public.profiles(user_id,display_name)
SELECT ('17330000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'R02 payroll 17330000 TEST '||n
FROM generate_series(1,8) n;
-- 1 owner A, 2 owner B, 3 Cashier B / Dealer Control A receiver,
-- 4 accountant A, 5 employee A, 6 global club_admin, 7 superadmin, 8 stranger.
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('17330000-0000-4000-8000-000000000011','17330000-0000-4000-8000-000000000001','R02 payroll 17330000 A TEST','TEST','approved'),
 ('17330000-0000-4000-8000-000000000012','17330000-0000-4000-8000-000000000002','R02 payroll 17330000 B TEST','TEST','approved');
INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES
 ('17330000-0000-4000-8000-000000000012','17330000-0000-4000-8000-000000000003','17330000-0000-4000-8000-000000000002');
INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES
 ('17330000-0000-4000-8000-000000000011','17330000-0000-4000-8000-000000000004','17330000-0000-4000-8000-000000000001');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('17330000-0000-4000-8000-000000000006','club_admin'),
 ('17330000-0000-4000-8000-000000000007','super_admin');
INSERT INTO public.dealers(id,club_id,user_id,full_name) VALUES
 ('17330000-0000-4000-8000-000000000021','17330000-0000-4000-8000-000000000011','17330000-0000-4000-8000-000000000005','R02 dealer A TEST'),
 ('17330000-0000-4000-8000-000000000022','17330000-0000-4000-8000-000000000012',NULL,'R02 dealer B TEST');
INSERT INTO public.payroll_periods(id,club_id,period_year,period_month,period_start,period_end,status) VALUES
 ('17330000-0000-4000-8000-000000000031','17330000-0000-4000-8000-000000000011',2026,10,'2026-10-01','2026-10-31','draft'),
 ('17330000-0000-4000-8000-000000000032','17330000-0000-4000-8000-000000000012',2026,10,'2026-10-01','2026-10-31','draft'),
 ('17330000-0000-4000-8000-000000000033','17330000-0000-4000-8000-000000000011',2026,11,'2026-11-01','2026-11-30','submitted');
INSERT INTO public.dealer_payroll(id,dealer_id,club_id,period_id,employment_type,net_pay_vnd,net_pay_after_tax_vnd) VALUES
 ('17330000-0000-4000-8000-000000000041','17330000-0000-4000-8000-000000000021','17330000-0000-4000-8000-000000000011','17330000-0000-4000-8000-000000000031','FT',5000000,5000000),
 ('17330000-0000-4000-8000-000000000042','17330000-0000-4000-8000-000000000022','17330000-0000-4000-8000-000000000012','17330000-0000-4000-8000-000000000032','FT',200000,200000);
INSERT INTO public.payment_records(id,period_id,club_id,status,total_net_vnd,dealer_count,prepared_by) VALUES
 ('17330000-0000-4000-8000-000000000051','17330000-0000-4000-8000-000000000031','17330000-0000-4000-8000-000000000011','prepared',5000000,1,'17330000-0000-4000-8000-000000000001'),
 ('17330000-0000-4000-8000-000000000052','17330000-0000-4000-8000-000000000032','17330000-0000-4000-8000-000000000012','prepared',200000,1,'17330000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 (SELECT count(*)=2 FROM public.payroll_periods WHERE id::text LIKE '17330000-%')
 AND (SELECT count(*)=1 FROM public.dealer_payroll WHERE id::text LIKE '17330000-%')
 AND (SELECT count(*)=1 FROM public.payment_records WHERE id::text LIKE '17330000-%'),
 'actual owner A reads A, never B, without a global role');
SELECT pg_temp.assert_payroll_boundary(public.transition_payroll_status_secure(
 '17330000-0000-4000-8000-000000000033','submitted','approved',NULL),
 'existing owner approval RPC remains usable despite revoked table UPDATE');

SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 (SELECT array_agg(id ORDER BY id)=ARRAY['17330000-0000-4000-8000-000000000032'::uuid] FROM public.payroll_periods WHERE id::text LIKE '17330000-%')
 AND (SELECT count(*)=1 FROM public.dealer_payroll WHERE id::text LIKE '17330000-%')
 AND (SELECT count(*)=1 FROM public.payment_records WHERE id::text LIKE '17330000-%'),
 'Cashier B sees only B before Dealer Control A grant');
DO $test$ BEGIN
 BEGIN UPDATE public.payroll_periods SET status='approved' WHERE id='17330000-0000-4000-8000-000000000031';
   RAISE EXCEPTION 'direct approval succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.payroll_audit_log(table_name,record_id,action)
   VALUES('payroll_periods','17330000-0000-4000-8000-000000000031','UPDATE');
   RAISE EXCEPTION 'audit forgery succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

-- Real R02 service-only invitation, not a simulated DTO permission.
SET LOCAL ROLE service_role;
SELECT * FROM public.apply_club_operator_invite(
 '17330000-0000-4000-8000-000000000001','17330000-0000-4000-8000-000000000011',
 '17330000-0000-4000-8000-000000000003','r02-payroll-3@example.test','dealer_control',false,'not_required');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_payroll_boundary(public.is_club_dealer_control(auth.uid(),
 '17330000-0000-4000-8000-000000000011'), 'receiver really has Dealer Control A');
SELECT pg_temp.assert_payroll_boundary(
 NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='17330000-0000-4000-8000-000000000011')
 AND NOT EXISTS(SELECT 1 FROM public.dealer_payroll WHERE club_id='17330000-0000-4000-8000-000000000011')
 AND NOT EXISTS(SELECT 1 FROM public.payment_records WHERE club_id='17330000-0000-4000-8000-000000000011'),
 'Dealer Control A adds no raw payroll authority in A');
DO $test$ BEGIN
 BEGIN INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)
 VALUES('17330000-0000-4000-8000-000000000041','BONUS',200000,'TEST forbidden A',auth.uid());
 RAISE EXCEPTION 'Dealer Control A added payroll adjustment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.transition_payroll_status_secure(
 '17330000-0000-4000-8000-000000000031','draft','submitted',NULL);
 RAISE EXCEPTION 'Dealer Control A submitted payroll'; EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'Actor is not authorized for payroll club 17330000-0000-4000-8000-000000000011' THEN RAISE; END IF; END;
END $test$;
WITH inserted AS (
 INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)
 VALUES('17330000-0000-4000-8000-000000000042','BONUS',200000,'R02 valid B TEST',auth.uid())
 RETURNING *
) SELECT pg_temp.assert_payroll_boundary((SELECT count(*)=1 FROM inserted),
 'Cashier B existing INSERT RETURNING draft adjustment works after A grant');
DO $test$ BEGIN
 BEGIN INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by,approved_by)
 VALUES('17330000-0000-4000-8000-000000000042','BONUS',1,'forged approval',auth.uid(),auth.uid());
 RAISE EXCEPTION 'approval metadata forgery succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)
 VALUES('17330000-0000-4000-8000-000000000042','BONUS',1,'forged creator','17330000-0000-4000-8000-000000000001');
 RAISE EXCEPTION 'creator forgery succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

-- Owner B may remove another valid actor's draft adjustment; not creator-only.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000002","role":"authenticated"}',true);
WITH removed AS (DELETE FROM public.payroll_adjustments WHERE reason='R02 valid B TEST' RETURNING *)
 SELECT pg_temp.assert_payroll_boundary((SELECT count(*)=1 FROM removed), 'owner B deletes Cashier B draft adjustment');

SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 (SELECT count(*)=2 FROM public.payroll_periods WHERE id::text LIKE '17330000-%')
 AND NOT EXISTS(SELECT 1 FROM public.payment_records WHERE id='17330000-0000-4000-8000-000000000052'),
 'accountant A reads A only');
WITH inserted AS (
 INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)
 VALUES('17330000-0000-4000-8000-000000000041','BONUS',200000,'R02 valid A TEST',auth.uid()) RETURNING *
) SELECT pg_temp.assert_payroll_boundary((SELECT count(*)=1 FROM inserted), 'accountant A draft INSERT RETURNING works');
RESET ROLE;
-- Existing frozen status: no client INSERT or DELETE after approval.
UPDATE public.payroll_periods SET status='approved' WHERE id='17330000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
WITH removed AS (DELETE FROM public.payroll_adjustments WHERE reason='R02 valid A TEST' RETURNING *)
 SELECT pg_temp.assert_payroll_boundary((SELECT count(*)=0 FROM removed), 'approved adjustment cannot be deleted');
DO $test$ BEGIN
 BEGIN INSERT INTO public.payroll_adjustments(payroll_id,adjustment_type,amount_vnd,reason,created_by)
 VALUES('17330000-0000-4000-8000-000000000041','BONUS',1,'late adjustment',auth.uid());
 RAISE EXCEPTION 'approved period adjustment inserted'; EXCEPTION WHEN object_not_in_prerequisite_state THEN
 IF SQLERRM <> 'payroll_adjustment_period_frozen' THEN RAISE; END IF; END;
END $test$;

-- Employee can read their saved receipt through the actual self-history RPC,
-- despite no raw table read entitlement. Foreign dealer remains forbidden.
SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000005',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 NOT EXISTS(SELECT 1 FROM public.dealer_payroll WHERE id='17330000-0000-4000-8000-000000000041')
 AND (public.get_my_dealer_payroll('17330000-0000-4000-8000-000000000021',2026,10)->>'net_pay_vnd')::bigint=5000000,
 'employee self-history preserves saved 5 million without raw payroll access');
DO $test$ BEGIN
 BEGIN PERFORM public.get_my_dealer_payroll('17330000-0000-4000-8000-000000000022',2026,10);
 RAISE EXCEPTION 'foreign dealer self-history read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;

SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000006',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE id::text LIKE '17330000-%')
 AND NOT EXISTS(SELECT 1 FROM public.payment_records WHERE id::text LIKE '17330000-%'),
 'global club_admin marker alone grants no cross-club raw salary data');
SELECT set_config('request.jwt.claim.sub','17330000-0000-4000-8000-000000000007',true);
SELECT set_config('request.jwt.claims','{"sub":"17330000-0000-4000-8000-000000000007","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
 (SELECT count(*)=3 FROM public.payroll_periods WHERE id::text LIKE '17330000-%')
 AND (SELECT count(*)=2 FROM public.payment_records WHERE id::text LIKE '17330000-%'),
 'trusted superadmin investigation read is retained');
RESET ROLE;

SELECT pg_temp.assert_payroll_boundary(
 (SELECT net_pay_vnd=5000000 FROM public.dealer_payroll WHERE id='17330000-0000-4000-8000-000000000041')
 AND (SELECT total_net_vnd=5000000 FROM public.payment_records WHERE id='17330000-0000-4000-8000-000000000051')
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='17330000-0000-4000-8000-000000000003'),
 'saved money unchanged and receiver has no global role');
SELECT 'PAYROLL_STORAGE_NATIVE_PASS';
ROLLBACK;
