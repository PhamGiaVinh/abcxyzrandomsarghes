-- LR01: retire player-only Tracker re-entry; Cashier reenter_tournament_player
-- remains the canonical buy-in/participation writer. No data repair or deletion.
-- Rollback: prefer forward fix; restoring the old writer reopens LR01. Use only
-- the verified pre-apply function/ACL snapshot under a separate controlled repair.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF md5(replace(pg_get_functiondef('public.re_enter_tournament(uuid,uuid,integer)'::regprocedure),chr(13),''))
     IS DISTINCT FROM 'bf4cc09a5caae43bc9eb7c53e364a08b' THEN
    RAISE EXCEPTION 'legacy_reentry_definition_drift';
  END IF;
  IF to_regprocedure('public.reenter_tournament_player(uuid,bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical_cashier_reentry_missing';
  END IF;
  IF NOT has_function_privilege('authenticated',
    'public.reenter_tournament_player(uuid,bigint,bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'canonical_cashier_reentry_execute_missing';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.re_enter_tournament(
  p_tournament_id uuid, p_player_id uuid, p_new_chip_count integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object('status','error','error','LEGACY_REENTRY_RETIRED',
    'message','Re-entry must use Cashier canonical participation and buy-in flow.');
END;
$$;
REVOKE ALL ON FUNCTION public.re_enter_tournament(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.re_enter_tournament(uuid,uuid,integer) TO authenticated;
COMMIT;
