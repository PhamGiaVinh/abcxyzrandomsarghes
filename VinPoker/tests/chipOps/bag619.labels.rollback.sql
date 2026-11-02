\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 r:=public.get_bag_tag_state('46cab483-91e7-4220-aacf-e17bdf05269c',1);
 ASSERT jsonb_array_length(r->'players')=2;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'players') x WHERE x->>'table_name' IS DISTINCT FROM 'Paid journey TEST 2'),'BAG619_CANONICAL_TABLE_NAME_MISSING';
 ASSERT NOT EXISTS(SELECT 1 FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1) x WHERE x.table_name IS DISTINCT FROM 'Paid journey TEST 2'),'BAG619_RECON_TABLE_NAME_MISSING';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'BAG619_OWNER_ROSTER_AND_RECON_NAMES_PASS';
