BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- Plan-only reuse for the measured canonical clock-summary dependency.
-- Preserve every participation/anomaly/display/stack expression and private ACL.
-- Never cache results or change entries, seats, chips, clock or financial data.
DO $participation_read_plan$
DECLARE fn record; wrapped text; before_owner oid; before_acl aclitem[];
 signature constant text:='floor_private.tournament_participation_v1(uuid)';
 expected_hash constant text:='56ba24560015d089565378b96e403925';
BEGIN
 SELECT p.*,n.nspname,pg_get_function_arguments(p.oid) arguments,
  replace(pg_get_functiondef(p.oid),chr(13),'') definition INTO STRICT fn
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=signature::regprocedure;
 IF md5(fn.definition)<>expected_hash OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')
  OR fn.prorettype<>'jsonb'::regtype OR fn.proretset OR fn.provolatile<>'s' OR NOT fn.prosecdef
  OR fn.proisstrict OR fn.proparallel<>'u' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR fn.proowner<>'postgres'::regrole OR fn.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR md5(replace(pg_get_functiondef('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)'::regprocedure),chr(13),''))<>'b7f94cbd3c2df431d317d6ba8180edbf'
 THEN RAISE EXCEPTION 'participation_read_plan_contract_drift'; END IF;
 before_owner:=fn.proowner;before_acl:=fn.proacl;
 wrapped:='BEGIN RETURN ('||regexp_replace(fn.prosrc,';[[:space:]]*$','')||'); END;';
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' COST %s AS %L',
  fn.nspname,fn.proname,fn.arguments,fn.procost,wrapped);
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn.oid AND
  (p.proowner IS DISTINCT FROM before_owner OR p.proacl IS DISTINCT FROM before_acl))
 THEN RAISE EXCEPTION 'participation_read_plan_owner_or_acl_changed'; END IF;
 INSERT INTO spectator_projection_v2.read_plan_originals_v1 VALUES(signature,fn.definition,expected_hash,
  (SELECT md5(replace(pg_get_functiondef(p.oid),chr(13),'')) FROM pg_proc p WHERE p.oid=fn.oid));
END $participation_read_plan$;

-- Compute that STABLE participation value once per requested tournament,
-- instead of repeating the same helper for each selected counter. The SQL
-- reader, snapshot, output, invoker, ACL and visibility gate are unchanged.
DO $clock_summary_once$
DECLARE signature constant text:='public.get_public_tournament_clock_summary(uuid)';
 definition text; rewritten text; before_owner oid; before_acl aclitem[]; before_oid oid;
 needle constant text:='), summary AS (';
BEGIN
 SELECT p.oid,p.proowner,p.proacl,replace(pg_get_functiondef(p.oid),chr(13),'')
 INTO STRICT before_oid,before_owner,before_acl,definition FROM pg_proc p WHERE p.oid=signature::regprocedure;
 IF md5(definition)<>'bf84cbeb48770e13805718e0d8a0def9'
  OR length(definition)-length(replace(definition,needle,''))<>length(needle)
 THEN RAISE EXCEPTION 'clock_summary_once_contract_drift';END IF;
 rewritten:=replace(definition,needle,'), summary AS MATERIALIZED (');
 EXECUTE rewritten;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=before_oid AND
  (p.proowner IS DISTINCT FROM before_owner OR p.proacl IS DISTINCT FROM before_acl))
 THEN RAISE EXCEPTION 'clock_summary_once_owner_or_acl_changed';END IF;
 INSERT INTO spectator_projection_v2.read_plan_originals_v1 VALUES(signature,definition,md5(definition),
  md5(replace(pg_get_functiondef(before_oid),chr(13),'')));
END $clock_summary_once$;
COMMIT;
