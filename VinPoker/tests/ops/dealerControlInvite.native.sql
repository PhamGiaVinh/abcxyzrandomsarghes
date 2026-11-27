\set ON_ERROR_STOP on
-- Full-schema R02 behavior: actual auth schema, membership readers and invite RPCs.
-- Based on the existing disposable acceptance cases, without substitute schemas.
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
SELECT ('17380000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'r02-native-invite-'||n||'@example.test','authenticated','authenticated',now(),now(),now()
FROM generate_series(1,11) n;
INSERT INTO public.profiles(user_id,display_name)
SELECT ('17380000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'R02 payroll 17380000 TEST '||n
FROM generate_series(1,11) n;
-- 1 owner A, 2 owner B, 3 Cashier B / Dealer Control A receiver,
-- 4 accountant A, 5 employee A, 6 global club_admin, 7 superadmin, 8 stranger.
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('17380000-0000-4000-8000-000000000011','17380000-0000-4000-8000-000000000001','R02 payroll 17380000 A TEST','TEST','approved'),
 ('17380000-0000-4000-8000-000000000012','17380000-0000-4000-8000-000000000002','R02 payroll 17380000 B TEST','TEST','approved');
INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES
 ('17380000-0000-4000-8000-000000000012','17380000-0000-4000-8000-000000000003','17380000-0000-4000-8000-000000000002');
INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES
 ('17380000-0000-4000-8000-000000000011','17380000-0000-4000-8000-000000000004','17380000-0000-4000-8000-000000000001');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('17380000-0000-4000-8000-000000000006','club_admin'),
 ('17380000-0000-4000-8000-000000000007','super_admin');
INSERT INTO public.dealers(id,club_id,user_id,full_name) VALUES
 ('17380000-0000-4000-8000-000000000021','17380000-0000-4000-8000-000000000011','17380000-0000-4000-8000-000000000005','R02 dealer A TEST'),
 ('17380000-0000-4000-8000-000000000022','17380000-0000-4000-8000-000000000012',NULL,'R02 dealer B TEST');
INSERT INTO public.payroll_periods(id,club_id,period_year,period_month,period_start,period_end,status) VALUES
 ('17380000-0000-4000-8000-000000000031','17380000-0000-4000-8000-000000000011',2026,10,'2026-10-01','2026-10-31','draft'),
 ('17380000-0000-4000-8000-000000000032','17380000-0000-4000-8000-000000000012',2026,10,'2026-10-01','2026-10-31','draft'),
 ('17380000-0000-4000-8000-000000000033','17380000-0000-4000-8000-000000000011',2026,11,'2026-11-01','2026-11-30','submitted');
INSERT INTO public.dealer_payroll(id,dealer_id,club_id,period_id,employment_type,net_pay_vnd,net_pay_after_tax_vnd) VALUES
 ('17380000-0000-4000-8000-000000000041','17380000-0000-4000-8000-000000000021','17380000-0000-4000-8000-000000000011','17380000-0000-4000-8000-000000000031','FT',5000000,5000000),
 ('17380000-0000-4000-8000-000000000042','17380000-0000-4000-8000-000000000022','17380000-0000-4000-8000-000000000012','17380000-0000-4000-8000-000000000032','FT',200000,200000);
INSERT INTO public.payment_records(id,period_id,club_id,status,total_net_vnd,dealer_count,prepared_by) VALUES
 ('17380000-0000-4000-8000-000000000051','17380000-0000-4000-8000-000000000031','17380000-0000-4000-8000-000000000011','prepared',5000000,1,'17380000-0000-4000-8000-000000000001'),
 ('17380000-0000-4000-8000-000000000052','17380000-0000-4000-8000-000000000032','17380000-0000-4000-8000-000000000012','prepared',200000,1,'17380000-0000-4000-8000-000000000002');

UPDATE auth.users SET email_confirmed_at=NULL WHERE id IN('17380000-0000-4000-8000-000000000009','17380000-0000-4000-8000-000000000010','17380000-0000-4000-8000-000000000011');

SELECT pg_temp.assert_payroll_boundary(
  NOT has_function_privilege('authenticated',
    'public.apply_club_operator_invite(uuid,uuid,uuid,text,text,boolean,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.accept_my_club_operator_invites()', 'EXECUTE'),
  'Dealer Control invite privileges remain caller-bound'
);

SET LOCAL ROLE service_role;
DO $test$
BEGIN
  BEGIN
    PERFORM public.apply_club_operator_invite(
      '17380000-0000-4000-8000-000000000008','17380000-0000-4000-8000-000000000011',
      '17380000-0000-4000-8000-000000000003','r02-native-invite-3@example.test','dealer_control',false,'not_required');
    RAISE EXCEPTION 'other-club owner granted Dealer Control';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'CLUB_OWNER_REQUIRED' THEN RAISE; END IF;
  END;
END $test$;

SELECT invite_id AS existing_invite, outcome AS existing_outcome FROM public.apply_club_operator_invite(
 '17380000-0000-4000-8000-000000000001','17380000-0000-4000-8000-000000000011',
 '17380000-0000-4000-8000-000000000003','r02-native-invite-3@example.test','dealer_control',false,'not_required') \gset
SELECT invite_id AS retry_invite, outcome AS retry_outcome FROM public.apply_club_operator_invite(
 '17380000-0000-4000-8000-000000000001','17380000-0000-4000-8000-000000000011',
 '17380000-0000-4000-8000-000000000003','r02-native-invite-3@example.test','dealer_control',false,'not_required') \gset
SELECT pg_temp.assert_payroll_boundary(
 :'existing_outcome' = 'GRANTED_EXISTING' AND :'retry_outcome' = 'ALREADY_ACTIVE'
 AND :'retry_invite' = :'existing_invite', 'duplicate grant is idempotent');

SELECT * FROM public.apply_club_operator_invite(
 '17380000-0000-4000-8000-000000000001','17380000-0000-4000-8000-000000000011',
 '17380000-0000-4000-8000-000000000009','r02-native-invite-9@example.test','dealer_control',true,'sent');
SELECT * FROM public.apply_club_operator_invite(
 '17380000-0000-4000-8000-000000000001','17380000-0000-4000-8000-000000000011',
 '17380000-0000-4000-8000-000000000010','r02-native-invite-10@example.test','dealer_control',true,'sent');
SELECT * FROM public.apply_club_operator_invite(
 '17380000-0000-4000-8000-000000000001','17380000-0000-4000-8000-000000000011',
 '17380000-0000-4000-8000-000000000011','r02-native-invite-11@example.test','dealer_control',true,'sent');
RESET ROLE;

SELECT pg_temp.assert_payroll_boundary(
 (SELECT count(*)=1 FROM public.club_dealer_controls
  WHERE club_id='17380000-0000-4000-8000-000000000011'
    AND user_id='17380000-0000-4000-8000-000000000003')
 AND (SELECT count(*)=1 FROM public.club_operator_invite_events WHERE invite_id=:'existing_invite'::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id IN (
   '17380000-0000-4000-8000-000000000009','17380000-0000-4000-8000-000000000010')),
 'only the confirmed existing user has membership before acceptance');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17380000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"17380000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
  ARRAY(SELECT public.dealer_control_club_ids(auth.uid()))=ARRAY['17380000-0000-4000-8000-000000000011'::uuid],
  'Dealer Swing reader includes only the newly granted Dealer Control club');
RESET ROLE;

UPDATE public.club_operator_invites SET invitation_sent_at=now()-interval '61 minutes'
 WHERE email_normalized='r02-native-invite-9@example.test';
UPDATE auth.users SET email_confirmed_at=now()
 WHERE email IN ('r02-native-invite-9@example.test','r02-native-invite-10@example.test','r02-native-invite-11@example.test');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17380000-0000-4000-8000-000000000009',true);
SELECT set_config('request.jwt.claims','{"sub":"17380000-0000-4000-8000-000000000009","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=0,
  'expired invite stays unaccepted even after email confirmation');
SELECT set_config('request.jwt.claim.sub','17380000-0000-4000-8000-000000000010',true);
SELECT set_config('request.jwt.claims','{"sub":"17380000-0000-4000-8000-000000000010","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=1,
  'fresh confirmed invite activates Dealer Control');
RESET ROLE;

UPDATE public.clubs SET owner_id='17380000-0000-4000-8000-000000000008'
 WHERE id='17380000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17380000-0000-4000-8000-000000000011',true);
SELECT set_config('request.jwt.claims','{"sub":"17380000-0000-4000-8000-000000000011","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=0,
  'a former owner invitation cannot activate Dealer Control');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
 '17380000-0000-4000-8000-000000000008', :'existing_invite'::uuid);
RESET ROLE;
SELECT pg_temp.assert_payroll_boundary(
 NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id IN (
   '17380000-0000-4000-8000-000000000003','17380000-0000-4000-8000-000000000009',
   '17380000-0000-4000-8000-000000000011'))
 AND EXISTS(SELECT 1 FROM public.club_dealer_controls
   WHERE club_id='17380000-0000-4000-8000-000000000011'
     AND user_id='17380000-0000-4000-8000-000000000010')
 AND EXISTS(SELECT 1 FROM public.club_cashiers
   WHERE club_id='17380000-0000-4000-8000-000000000012'
     AND user_id='17380000-0000-4000-8000-000000000003'),
 'revocation is scoped to Dealer Control in A and preserves Cashier in B');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17380000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"17380000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.assert_payroll_boundary(
  NOT EXISTS(SELECT public.dealer_control_club_ids(auth.uid())),
  'Dealer Swing reader no longer includes the revoked club for the same signed-in actor');
RESET ROLE;
SELECT 'DEALER_CONTROL_NATIVE_PASS';
ROLLBACK;
