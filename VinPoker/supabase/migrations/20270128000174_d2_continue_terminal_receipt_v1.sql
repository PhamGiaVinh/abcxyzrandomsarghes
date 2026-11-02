-- LOCAL/SOURCE ONLY. CLI candidate20261018231602 reserved slot174 after173.
-- Recover an immutable Continue receipt after tournament completion without
-- permitting a new Continue. Actor/club authority and fingerprint stay required.
-- Recovery: suspend this RPC via the companion script; never delete receipts.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE
 target regprocedure:='public.floor_continue_tournament_redraw_v1(uuid,bigint,uuid)'::regprocedure;
 definition text:=pg_get_functiondef(target);
 prior_acl aclitem[];
 old_guard text:=$old$IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN$old$;
 release_guard text:=$old$  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tournament.club_id);$old$;
BEGIN
 SELECT proacl INTO prior_acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
   AND md5(prosrc)='2f2b2e9ff3b5b29de67130e344eb5320' AND prosecdef
   AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""'])
   OR has_function_privilege('anon',target,'EXECUTE')
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'd2_continue174_catalog_drift';
 END IF;
 IF length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
  OR length(definition)-length(replace(definition,release_guard,''))<>length(release_guard) THEN
   RAISE EXCEPTION 'd2_continue174_anchor_drift';
 END IF;
 definition:=replace(definition,old_guard,'IF NOT FOUND THEN');
 definition:=replace(definition,release_guard,$new$  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;

  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tournament.club_id);$new$);
 EXECUTE definition;
 IF (SELECT proacl IS DISTINCT FROM prior_acl FROM pg_proc WHERE oid=target) THEN
   RAISE EXCEPTION 'd2_continue174_acl_changed';
 END IF;
END $patch$;
COMMIT;
