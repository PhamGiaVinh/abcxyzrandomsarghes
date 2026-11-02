\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND club_id='7f3c6f90-3667-4c8c-9a00-6f00da680d84'
  AND status='active' AND buy_in=100000 AND rake_amount=0 AND prize_pool=300000 AND itm_places=1 AND registration_closed_at IS NOT NULL);
 ASSERT (SELECT count(*)=1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740' AND tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'
  AND status='applied' AND entries_snapshot=3 AND prize_pool_snapshot=300000 AND buy_in_snapshot=100000 AND rake_snapshot=0
  AND archetype='DAILY' AND itm_percent=0.15 AND min_cash_x=2 AND effective_floor=200000 AND rounding_unit=100000 AND itm_places=1);
 ASSERT (SELECT jsonb_agg(jsonb_build_array(position,amount) ORDER BY position)='[[1,300000]]'::jsonb FROM public.tournament_prizes WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 ASSERT (SELECT count(*)=3 AND sum(applied_amount)=300000 FROM public.cashier_buyin_movements WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND is_active);
 ASSERT (SELECT count(*)=3 AND count(*) FILTER(WHERE finished_place IS NOT NULL)=0 FROM public.tournament_entries WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 -- Do not consume or alter the primary Single244 payout/participants to test retries.
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='deb73d84-4bdd-46a2-9b31-527de3b30163' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='applied' AND prize_pool_snapshot=900000);
END $$;
ROLLBACK;
SELECT 'PAYOUT700_ONE_FROZEN_DAILY_RUN_300K_ACTIVE_THREE_SEATS60K_CASH300K_NO_PAYMENT_PRIMARY_PRESERVED_PASS';
