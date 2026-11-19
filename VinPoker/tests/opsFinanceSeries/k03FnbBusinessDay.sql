\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_k03' THEN
    RAISE EXCEPTION 'Expected disposable K03 database';
  END IF;
END $$;

-- Reader fixture: verified source amounts and event dates, without invoking payment.
DO $fixture$
DECLARE
  actor_id uuid := gen_random_uuid();
  other_actor uuid := gen_random_uuid();
  club_id_fixture uuid := gen_random_uuid();
  other_club uuid := gen_random_uuid();
  day_one jsonb;
  day_two jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (actor_id), (other_actor);
  INSERT INTO public.profiles(user_id, display_name) VALUES (actor_id,'K03 TEST A'), (other_actor,'K03 TEST B');
  INSERT INTO public.clubs(id,owner_id,name,region,status)
    VALUES (club_id_fixture,actor_id,'K03 TEST A','TEST','approved'), (other_club,other_actor,'K03 TEST B','TEST','approved');
  INSERT INTO public.fnb_settings(club_id,fnb_in_club_net) VALUES (club_id_fixture,true), (other_club,true)
    ON CONFLICT (club_id) DO UPDATE SET fnb_in_club_net=true;
  -- Satisfy the existing shift trigger while seeding historical fixture facts.
  PERFORM pg_advisory_xact_lock(hashtextextended('fnb-cash-shift:' || club_id_fixture::text, 718));
  PERFORM pg_advisory_xact_lock(hashtextextended('fnb-cash-shift:' || other_club::text, 718));
  INSERT INTO public.fnb_orders(club_id,status,source,created_by,client_request_id,subtotal_vnd,cogs_vnd,paid_at,shipped_at,cancelled_at)
    VALUES
      (club_id_fixture,'cancelled','counter',actor_id,gen_random_uuid()::text,100000,30000,
        '2026-10-31 23:59:59.999999+07','2026-10-31 23:59:59.999999+07','2026-11-01 00:00:00+07'),
      (other_club,'paid','counter',other_actor,gen_random_uuid()::text,70000,0,
        '2026-11-01 00:00:00+07',NULL,NULL);

  PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
  SET LOCAL ROLE authenticated;
  day_one := public.get_club_finance_summary('2026-10-31 00:00:00+07','2026-10-31 23:59:59.999999+07',club_id_fixture);
  day_two := public.get_club_finance_summary('2026-11-01 00:00:00+07','2026-11-01 23:59:59.999999+07',club_id_fixture);
  ASSERT day_one#>>'{revenue,fnb}' = '100000', 'Original revenue belongs to Oct 31';
  ASSERT day_one#>>'{cost,fnbCogs}' = '30000', 'Original cost belongs to Oct 31';
  ASSERT day_two#>>'{revenue,fnb}' = '-100000', 'Only this club refund belongs to Nov 1';
  ASSERT day_two#>>'{cost,fnbCogs}' = '0', 'Shipped order cost is retained without an inventory reversal';
END
$fixture$;
ROLLBACK;
