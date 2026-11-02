-- CLI candidate20261023140149 -> forward slot248. LOCAL candidate, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000248')
 OR EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.staking_audit_action'::regtype AND enumlabel='player_close_early')
 THEN RAISE EXCEPTION 'staking248_catalog_collision';END IF;
END $$;
ALTER TYPE public.staking_audit_action ADD VALUE 'player_close_early';
COMMIT;
