-- CLI candidate20261019085415; reserved forward180 after source/catalog check.
-- LOCAL qualification only. No live approval, ledger repair or result backfill.
-- Reject zero survivors before any ranking UPDATE; retain ranking/prize policy.
-- Recovery: reviewed forward compensation restoring ONLY the pinned old guard;
-- never recompute existing places/payments or replay the migration archive.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $guard$
DECLARE target oid:=pg_catalog.to_regprocedure('public.finalize_tournament_results(uuid)');
 definition text; expected text; metadata jsonb; after_metadata jsonb;
 anchor text:='IF v_survivors > 1 THEN'; replacement text:='IF v_survivors <> 1 THEN';
BEGIN
 IF current_user<>'postgres' OR target IS NULL THEN RAISE EXCEPTION 'finalizer180_reviewed_owner_dependency_required'; END IF;
 definition:=replace(pg_catalog.pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'05f8be81b2c5414bf35d745c54133cdb' THEN RAISE EXCEPTION 'finalizer180_definition_drift'; END IF;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'finalizer180_anchor_drift'; END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
  'args',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
 INTO STRICT metadata FROM pg_catalog.pg_proc WHERE oid=target;
 expected:=replace(definition,anchor,replacement);
 EXECUTE expected;
 IF replace(pg_catalog.pg_get_functiondef(target),chr(13),'')<>expected THEN RAISE EXCEPTION 'finalizer180_post_definition_mismatch'; END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
  'args',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
 INTO STRICT after_metadata FROM pg_catalog.pg_proc WHERE oid=target;
 IF after_metadata IS DISTINCT FROM metadata THEN RAISE EXCEPTION 'finalizer180_abi_security_metadata_changed'; END IF;
END;
$guard$;
COMMIT;
