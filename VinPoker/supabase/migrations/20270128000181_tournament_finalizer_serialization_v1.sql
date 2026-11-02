-- CLI candidate20261019090321; forward181 after source collision check.
-- LOCAL qualification only, not live approval or migration ledger repair.
-- Lock tournament BEFORE reading survivors/ranking. Canonical cashier/Floor/
-- close writers acquire tournament before participation rows. A late wait in
-- UPDATE is too late: earlier survivor count can already be stale.
-- No ranking, payout, finalization eligibility or registration policy change.
-- Recovery: separately reviewed forward compensation restoring only the pinned
-- unlocked SELECT; retain entries, ranks, receipts, payments and audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $guard$
DECLARE target oid:=pg_catalog.to_regprocedure('public.finalize_tournament_results(uuid)');
 definition text; expected text; metadata jsonb; after_metadata jsonb;
 anchor text:='SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id;';
 replacement text:='SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;';
BEGIN
 IF current_user<>'postgres' OR target IS NULL THEN RAISE EXCEPTION 'finalizer181_reviewed_owner_dependency_required'; END IF;
 definition:=replace(pg_catalog.pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'5bcf4d94b3eff762b6776bbef373d57e' THEN RAISE EXCEPTION 'finalizer181_definition_drift'; END IF;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'finalizer181_anchor_drift'; END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
  'args',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
 INTO STRICT metadata FROM pg_catalog.pg_proc WHERE oid=target;
 expected:=replace(definition,anchor,replacement);
 EXECUTE expected;
 IF replace(pg_catalog.pg_get_functiondef(target),chr(13),'')<>expected THEN RAISE EXCEPTION 'finalizer181_post_definition_mismatch'; END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
  'args',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
 INTO STRICT after_metadata FROM pg_catalog.pg_proc WHERE oid=target;
 IF after_metadata IS DISTINCT FROM metadata THEN RAISE EXCEPTION 'finalizer181_abi_security_metadata_changed'; END IF;
END;
$guard$;
COMMIT;
