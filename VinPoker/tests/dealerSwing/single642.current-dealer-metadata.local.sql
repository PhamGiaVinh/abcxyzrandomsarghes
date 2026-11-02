\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.single642_dealer_fixture') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealers WHERE id::text LIKE 'e6420000-0000-4000-8000-%');
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')=8;
 ASSERT (SELECT count(*) FROM public.dealer_shifts WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND closed_at IS NULL AND archived_at IS NULL)=1;
 ASSERT (SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b') IS NOT TRUE;
END $$;
CREATE TEMP TABLE single642_prior_dealers AS SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text) facts FROM public.dealers d;
INSERT INTO public.dealers(id,club_id,full_name,status)
 SELECT ('e6420000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d4427834-5f5f-48ef-bde5-e2dc388ed00b','Clean R11 TEST dealer current '||n,'active' FROM generate_series(1,4)n;
CREATE TABLE floor_private.single642_dealer_fixture AS SELECT jsonb_build_object(
 'club','d4427834-5f5f-48ef-bde5-e2dc388ed00b','tour','c367013a-3ed3-48af-ad48-3915acadc50e',
 'actor','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','dealerShift','dc91889f-0f73-4e2c-aaf1-d539a6072aed',
 'dealers',(SELECT jsonb_agg(id ORDER BY id) FROM public.dealers WHERE id::text LIKE 'e6420000-0000-4000-8000-%'),
 'originalDealers',(SELECT fixture->'dealers' FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682),
 'createdAt',statement_timestamp(),'purpose','Synthetic current TEST dealer metadata only; no attendance, assignment, hours, checkout or payroll seeded') fixture;
ALTER TABLE floor_private.single642_dealer_fixture ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.single642_dealer_fixture FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 ASSERT (SELECT facts FROM single642_prior_dealers)=(SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text) FROM public.dealers d WHERE id::text NOT LIKE 'e6420000-0000-4000-8000-%');
 ASSERT (SELECT count(*) FROM public.dealers WHERE id::text LIKE 'e6420000-0000-4000-8000-%' AND user_id IS NULL)=4;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id::text LIKE 'e6420000-0000-4000-8000-%');
END $$;
SELECT pg_temp.single638_facts()=:'before' AS unchanged \gset
\if :unchanged
\else
DO $$ BEGIN RAISE EXCEPTION 'single642_metadata_operational_delta'; END $$;
\endif
COMMIT;
SELECT 'SINGLE642_FOUR_SYNTHETIC_DEALER_METADATA_ONLY_PRIOR_DEALERS_AND_FOURTEEN_FACTS_UNCHANGED_PASS';
