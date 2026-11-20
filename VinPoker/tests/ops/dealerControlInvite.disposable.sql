\set ON_ERROR_STOP on
-- Run after disposableDb.integration.sql. Only the existing Dealer Control
-- membership shape is seeded here; the invitation functions are the real candidate.
CREATE TABLE public.club_dealer_controls (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
ALTER TABLE public.club_dealer_controls ENABLE ROW LEVEL SECURITY;
\i :dealer_scope_fixture
\ir ../../supabase/pending-migrations/20261119141550_ops_dealer_control_invites.sql

BEGIN;
SELECT public.ops_test_assert(
  NOT has_function_privilege('authenticated',
    'public.apply_club_operator_invite(uuid,uuid,uuid,text,text,boolean,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.accept_my_club_operator_invites()', 'EXECUTE'),
  'Dealer Control invite privileges remain caller-bound'
);

INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0000-000000000031', 'expired.dealer@example.com'),
 ('00000000-0000-0000-0000-000000000032', 'fresh.dealer@example.com'),
 ('00000000-0000-0000-0000-000000000033', 'previous.owner.dealer@example.com');

SET LOCAL ROLE service_role;
DO $test$
BEGIN
  BEGIN
    PERFORM public.apply_club_operator_invite(
      '00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000003','known.cashier@example.com','dealer_control',false,'not_required');
    RAISE EXCEPTION 'other-club owner granted Dealer Control';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'CLUB_OWNER_REQUIRED' THEN RAISE; END IF;
  END;
END $test$;

SELECT invite_id AS existing_invite, outcome AS existing_outcome FROM public.apply_club_operator_invite(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000003','known.cashier@example.com','dealer_control',false,'not_required') \gset
SELECT invite_id AS retry_invite, outcome AS retry_outcome FROM public.apply_club_operator_invite(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000003','known.cashier@example.com','dealer_control',false,'not_required') \gset
SELECT public.ops_test_assert(
 :'existing_outcome' = 'GRANTED_EXISTING' AND :'retry_outcome' = 'ALREADY_ACTIVE'
 AND :'retry_invite' = :'existing_invite', 'duplicate grant is idempotent');

SELECT * FROM public.apply_club_operator_invite(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000031','expired.dealer@example.com','dealer_control',true,'sent');
SELECT * FROM public.apply_club_operator_invite(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000032','fresh.dealer@example.com','dealer_control',true,'sent');
SELECT * FROM public.apply_club_operator_invite(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000033','previous.owner.dealer@example.com','dealer_control',true,'sent');
RESET ROLE;

SELECT public.ops_test_assert(
 (SELECT count(*)=1 FROM public.club_dealer_controls
  WHERE club_id='00000000-0000-0000-0000-000000000010'
    AND user_id='00000000-0000-0000-0000-000000000003')
 AND (SELECT count(*)=1 FROM public.club_operator_invite_events WHERE invite_id=:'existing_invite'::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id IN (
   '00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000032')),
 'only the confirmed existing user has membership before acceptance');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.ops_test_assert(
  ARRAY(SELECT public.dealer_control_club_ids(auth.uid()))=ARRAY['00000000-0000-0000-0000-000000000010'::uuid],
  'Dealer Swing reader includes only the newly granted Dealer Control club');
RESET ROLE;

UPDATE public.club_operator_invites SET invitation_sent_at=now()-interval '61 minutes'
 WHERE email_normalized='expired.dealer@example.com';
UPDATE auth.users SET email_confirmed_at=now()
 WHERE email IN ('expired.dealer@example.com','fresh.dealer@example.com','previous.owner.dealer@example.com');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000031',true);
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=0,
  'expired invite stays unaccepted even after email confirmation');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000032',true);
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=1,
  'fresh confirmed invite activates Dealer Control');
RESET ROLE;

UPDATE public.clubs SET owner_id='00000000-0000-0000-0000-000000000099'
 WHERE id='00000000-0000-0000-0000-000000000010';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000033',true);
SELECT public.ops_test_assert(
  (public.accept_my_club_operator_invites()->>'acceptedCount')::int=0,
  'a former owner invitation cannot activate Dealer Control');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT * FROM public.revoke_club_operator_invite(
 '00000000-0000-0000-0000-000000000099', :'existing_invite'::uuid);
RESET ROLE;
SELECT public.ops_test_assert(
 NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE user_id IN (
   '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000033'))
 AND EXISTS(SELECT 1 FROM public.club_dealer_controls
   WHERE club_id='00000000-0000-0000-0000-000000000010'
     AND user_id='00000000-0000-0000-0000-000000000032')
 AND EXISTS(SELECT 1 FROM public.club_cashiers
   WHERE club_id='00000000-0000-0000-0000-000000000020'
     AND user_id='00000000-0000-0000-0000-000000000003'),
 'revocation is scoped to Dealer Control in A and preserves Cashier in B');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.ops_test_assert(
  NOT EXISTS(SELECT public.dealer_control_club_ids(auth.uid())),
  'Dealer Swing reader no longer includes the revoked club for the same signed-in actor');
RESET ROLE;
ROLLBACK;
