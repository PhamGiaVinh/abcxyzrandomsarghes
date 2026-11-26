-- Run only on a qualified loopback fixture. Required psql variables:
-- actor_id, player_id, owner_a_id, club_a, club_b, deal_ids (uuid[] literal).
-- Fixture contains two closed/refunded deals per club; actor is Cashier A
-- and owner/Cashier B, player is their participant, owner_a owns only A.
-- No auth/RLS helper doubles. Caller roles are transaction-local; no writes persist.
BEGIN;
DO $guard$
BEGIN
  IF (pg_catalog.inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet)) IS DISTINCT FROM true
     OR NOT pg_catalog.starts_with(pg_catalog.current_database(), 'vinpoker_ops_') THEN
    RAISE EXCEPTION 'Cashier staking read test requires the isolated loopback fixture database';
  END IF;
END;
$guard$;
SELECT pg_catalog.set_config('test.cashier_actor', :'actor_id', true);
SELECT pg_catalog.set_config('test.cashier_player', :'player_id', true);
SELECT pg_catalog.set_config('test.cashier_owner_a', :'owner_a_id', true);
SELECT pg_catalog.set_config('test.cashier_club_a', :'club_a', true);
SELECT pg_catalog.set_config('test.cashier_club_b', :'club_b', true);
SELECT pg_catalog.set_config('test.cashier_deals', :'deal_ids', true);
CREATE TEMP TABLE cashier_history_before ON COMMIT DROP AS
SELECT to_jsonb(d) AS row_value FROM public.staking_deals d
 WHERE id = ANY(current_setting('test.cashier_deals')::uuid[]);
DO $fixture$
BEGIN
  IF (SELECT count(*) FROM cashier_history_before) <> 4 THEN
    RAISE EXCEPTION 'Expected four retained closed/refunded fixture deals';
  END IF;
END;
$fixture$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.cashier_actor'), 'role', 'authenticated')::text, true);
DO $cashier$
DECLARE updated_count integer;
BEGIN
  IF public.has_role(auth.uid(), 'cashier'::public.app_role)
     OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
     OR auth.uid()=current_setting('test.cashier_player')::uuid
     OR EXISTS (SELECT 1 FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
         AND (player_id=auth.uid() OR backer_id=auth.uid())) THEN
    RAISE EXCEPTION 'Scoped fixture must not rely on a global role or participant access';
  END IF;
  IF NOT public.is_club_cashier(auth.uid(), current_setting('test.cashier_club_a')::uuid)
     OR NOT public.is_club_cashier(auth.uid(), current_setting('test.cashier_club_b')::uuid)
     OR (SELECT count(*) FROM public.staking_deals
          WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])) <> 4 THEN
    RAISE EXCEPTION 'Scoped cashier must read both authorized clubs without a global cashier role';
  END IF;
  WITH changed AS (
    UPDATE public.staking_deals SET result_prize_vnd=77777
     WHERE id=ANY(current_setting('test.cashier_deals')::uuid[]) RETURNING 1
  ) SELECT count(*) INTO updated_count FROM changed;
  IF updated_count <> 0 THEN
    RAISE EXCEPTION 'The SELECT policy must not authorize direct deal updates';
  END IF;
END;
$cashier$;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.cashier_owner_a'), 'role', 'authenticated')::text, true);
DO $owner$
BEGIN
  IF (SELECT count(*) FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
         AND club_id=current_setting('test.cashier_club_a')::uuid) <> 2
     OR EXISTS (SELECT 1 FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
         AND club_id=current_setting('test.cashier_club_b')::uuid) THEN
    RAISE EXCEPTION 'Owner A must not inherit private deal visibility in B';
  END IF;
END;
$owner$;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.cashier_player'), 'role', 'authenticated')::text, true);
DO $participant$
BEGIN
  IF (SELECT count(*) FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])) <> 4 THEN
    RAISE EXCEPTION 'Existing participant visibility must remain intact';
  END IF;
END;
$participant$;

RESET ROLE;
DELETE FROM public.club_cashiers
 WHERE club_id=current_setting('test.cashier_club_a')::uuid
   AND user_id=current_setting('test.cashier_actor')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.cashier_actor'), 'role', 'authenticated')::text, true);
DO $revoked$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
         AND club_id=current_setting('test.cashier_club_a')::uuid)
     OR (SELECT count(*) FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
         AND club_id=current_setting('test.cashier_club_b')::uuid) <> 2 THEN
    RAISE EXCEPTION 'Withdrawing A must hide A and retain valid B';
  END IF;
END;
$revoked$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $anonymous$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staking_deals
       WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])) THEN
    RAISE EXCEPTION 'Closed/refunded deals must not become anonymously visible';
  END IF;
END;
$anonymous$;

RESET ROLE;
DO $immutable$
BEGIN
  IF EXISTS (
    (SELECT row_value FROM cashier_history_before
     EXCEPT SELECT to_jsonb(d) FROM public.staking_deals d WHERE id=ANY(current_setting('test.cashier_deals')::uuid[]))
    UNION ALL
    (SELECT to_jsonb(d) FROM public.staking_deals d WHERE id=ANY(current_setting('test.cashier_deals')::uuid[])
     EXCEPT SELECT row_value FROM cashier_history_before)
  ) THEN RAISE EXCEPTION 'Read tests changed the retained financial fixture'; END IF;
END;
$immutable$;
ROLLBACK;
