-- Reviewed compensation candidate: restore only the two pinned query bodies.
-- No historical report, money movement, payout or audit rewrites.
-- The close writer retains its tournament-row lock; readiness remains a stable read.
-- Apply only under explicit release rollback authorization. Retain all reports.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $patch$
DECLARE r record; target oid; definition text; expected text; before_metadata jsonb; after_metadata jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'close_paid_prize_owner_required'; END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public.close_tournament(uuid,text)','ec7a85d3aa0484eaff6e46c448426119',
   E'  SELECT COALESCE(SUM(prize_amount), 0)::bigint INTO v_prize\n  FROM public.tournament_prize_payments\n  WHERE tournament_id = p_tournament_id AND status = ''paid'';',
   E'  SELECT COALESCE(SUM(prize), 0)::bigint INTO v_prize\n  FROM public.tournament_eliminations\n  WHERE tournament_id = p_tournament_id;'),
  ('public.get_tournament_close_readiness_v1(uuid)','c1b47fb0f52ceeba7b4b12ba597fbc9a',
   E'  SELECT coalesce(sum(prize_amount), 0)::bigint INTO v_prize\n  FROM public.tournament_prize_payments WHERE tournament_id = p_tournament_id AND status = ''paid'';',
   E'  SELECT coalesce(sum(prize), 0)::bigint INTO v_prize\n  FROM public.tournament_eliminations WHERE tournament_id = p_tournament_id;')
 ) x(signature,prior_md5,old_query,new_query) LOOP
  target:=pg_catalog.to_regprocedure(r.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'close_paid_prize_dependency_missing'; END IF;
  SELECT replace(pg_catalog.pg_get_functiondef(target),chr(13),'') INTO definition;
  IF md5(definition)<>r.prior_md5 OR
   (length(definition)-length(replace(definition,r.old_query,'')))/length(r.old_query)<>1
  THEN RAISE EXCEPTION 'close_paid_prize_definition_drift'; END IF;
  SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
   'arguments',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
  INTO STRICT before_metadata FROM pg_catalog.pg_proc WHERE oid=target;
  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid=target))<>'postgres'
   OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=target)
  THEN RAISE EXCEPTION 'close_paid_prize_security_drift'; END IF;
  expected:=replace(definition,r.old_query,r.new_query);
  EXECUTE expected;
  IF replace(pg_catalog.pg_get_functiondef(target),chr(13),'')<>expected
  THEN RAISE EXCEPTION 'close_paid_prize_post_definition_mismatch'; END IF;
  SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,
   'arguments',pg_catalog.pg_get_function_identity_arguments(oid),'result',pg_catalog.pg_get_function_result(oid),'volatility',provolatile)
  INTO STRICT after_metadata FROM pg_catalog.pg_proc WHERE oid=target;
  IF after_metadata IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'close_paid_prize_metadata_changed'; END IF;
 END LOOP;
END $patch$;
COMMIT;
