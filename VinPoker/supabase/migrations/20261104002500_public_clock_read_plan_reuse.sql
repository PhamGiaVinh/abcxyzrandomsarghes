BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- Store this second clock preimage separately: migration023 already retains
-- the original SQL definition for its MATERIALIZED change. Recovery is ordered.
CREATE TABLE spectator_projection_v2.clock_read_plan_original_v1 (
 signature text PRIMARY KEY CHECK(signature='public.get_public_tournament_clock_summary(uuid)'),
 definition text NOT NULL,
 original_definition_hash text NOT NULL,
 wrapped_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.clock_read_plan_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.clock_read_plan_original_v1 FROM PUBLIC,anon,authenticated,service_role;

DO $clock_read_plan$
DECLARE fn record; wrapped text; before_metadata jsonb;
 target_signature constant text:='public.get_public_tournament_clock_summary(uuid)';
 expected_hash constant text:='36cd26e13820420f0f7405f6211c34ea';
BEGIN
 SELECT p.*,n.nspname,pg_get_function_arguments(p.oid) arguments,
  pg_get_function_result(p.oid) result,
  replace(pg_get_functiondef(p.oid),chr(13),'') definition
 INTO STRICT fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid=target_signature::regprocedure;
 IF md5(fn.definition)<>expected_hash OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')
  OR NOT fn.proretset OR fn.provolatile<>'s' OR NOT fn.prosecdef
  OR fn.proisstrict OR fn.proparallel<>'u' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR NOT EXISTS(SELECT 1 FROM spectator_projection_v2.read_plan_originals_v1 r
   WHERE r.signature=target_signature AND r.wrapped_definition_hash=expected_hash)
 THEN RAISE EXCEPTION 'clock_read_plan_contract_drift'; END IF;
 SELECT to_jsonb(p)-'prosrc'-'prolang' INTO before_metadata FROM pg_proc p WHERE p.oid=fn.oid;
 -- Cache the plan only. Every parameter, predicate and clock expression remains
 -- in the original STABLE query and runs against the caller's current snapshot.
 wrapped:='BEGIN RETURN QUERY '||regexp_replace(fn.prosrc,';[[:space:]]*$','')||'; END;';
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I(%s) RETURNS %s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' COST %s ROWS %s AS %L',
  fn.nspname,fn.proname,fn.arguments,fn.result,fn.procost,fn.prorows,wrapped);
 IF (SELECT to_jsonb(p)-'prosrc'-'prolang' FROM pg_proc p WHERE p.oid=fn.oid) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'clock_read_plan_metadata_changed'; END IF;
 INSERT INTO spectator_projection_v2.clock_read_plan_original_v1 VALUES(target_signature,fn.definition,expected_hash,
  (SELECT md5(replace(pg_get_functiondef(fn.oid),chr(13),''))));
END $clock_read_plan$;
COMMIT;
