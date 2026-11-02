-- Synthetic physical TEST assets only, NOT declaration-UI acceptance.
-- No legacy row adoption/rename/backfill. Seats/entries still require real RPCs.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_events WHERE id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
  AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND name='Main Event browser local TEST 164');
 ASSERT (SELECT count(*) FROM public.multi_day_final_participations_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d')=15;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_tables WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
END $$;
CREATE TEMP TABLE assets184_existing ON COMMIT DROP AS SELECT id,to_jsonb(g) data FROM public.game_tables g;
DO $$ DECLARE n integer; prior public.game_tables;
BEGIN
 FOREACH n IN ARRAY ARRAY[7,8,9] LOOP
  SELECT * INTO prior FROM public.game_tables WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND table_number=n;
  IF FOUND THEN
   ASSERT prior.table_name='Linked Main Event D2 TEST '||n::text,'NEVER_ADOPT_OTHER_ASSET';
  ELSE
   INSERT INTO public.game_tables(club_id,table_name,table_number,table_type,game_type,status,operational_status)
   VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','Linked Main Event D2 TEST '||n::text,n,'tournament','NLH','inactive','available');
  END IF;
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM assets184_existing old LEFT JOIN public.game_tables g ON g.id=old.id
  WHERE g.id IS NULL OR to_jsonb(g) IS DISTINCT FROM old.data),'EXISTING_ASSET_CHANGED';
END $$;
SELECT id,table_number,table_name FROM public.game_tables
 WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND table_number IN(7,8,9) ORDER BY table_number;
COMMIT;
