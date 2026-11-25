-- Controlled rollback of THIS read package only. No data/index/legacy routine change.
-- Pending-only: production execution still requires the approved release runbook.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF to_regprocedure('public.get_pt_statement_installments_v1(uuid)') IS NULL
    AND to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE
    ((p.oid=to_regprocedure('public.get_pt_statement_installments_v1(uuid)') AND md5(p.prosrc)='191f8b9de02702a828a1628d73ba8658'
        AND p.proargnames=ARRAY['p_statement_id'] AND p.pronargdefaults=0 AND p.proargdefaults IS NULL)
      OR (p.oid=to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') AND md5(p.prosrc)='5788d4c196fba4cd5bae989f858d155c'
        AND p.proargnames=ARRAY['p_club_id','p_dealer_id','p_before_at','p_before_id'] AND p.pronargdefaults=2
        AND pg_get_expr(p.proargdefaults,0)='NULL::timestamp with time zone, NULL::uuid'))
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
    AND p.prokind='f' AND NOT p.proretset AND p.prorettype='jsonb'::regtype
    AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.proconfig=ARRAY['search_path=""']
    AND p.proacl='{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'PT_STATEMENT_READS_ROLLBACK_DRIFT'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.get_pt_statement_installments_v1(uuid);
COMMIT;
