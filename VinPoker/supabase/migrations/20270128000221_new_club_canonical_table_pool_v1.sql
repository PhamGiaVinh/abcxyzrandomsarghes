-- Forward-only: future clubs receive the same100 physical assets, now canonical.
-- Never infer or backfill identity on existing legacy tables/sessions.
-- Local recovery: tests/floorTableControlV3/newClub250.recovery.pg17.sql.
-- Recovery restores only future-club behavior; it never deletes emitted assets.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.initialize_club_tables()') IS NULL
 OR md5(replace(pg_get_functiondef('public.initialize_club_tables()'::regprocedure),chr(13),''))<>'9e096f276b9fd41f0a2212ef14ad1bdc'
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clubs'::regclass
  AND tgname='trg_initialize_club_tables' AND tgfoid='public.initialize_club_tables()'::regprocedure AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'canonical_pool221_seed_definition_drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.initialize_club_tables()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.game_tables(club_id,table_name,table_number,table_type,status,game_type,operational_status)
 SELECT NEW.id,'Bàn '||n,n,'tournament','inactive','NLH','available'
 FROM pg_catalog.generate_series(1,100) AS n;
 RETURN NEW;
END;
$$;
DO $$ BEGIN
 IF (SELECT proconfig FROM pg_proc WHERE oid='public.initialize_club_tables()'::regprocedure)
  IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN RAISE EXCEPTION 'canonical_pool221_path'; END IF;
END $$;
COMMIT;
