BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- Cache query plans per backend, never query results. The exact existing SQL
-- expression, parameters, visibility/void/session gates and public payload stay
-- unchanged. The current-hand preimage is AFTER bounded migration021.
CREATE TABLE spectator_projection_v2.read_plan_originals_v1 (
 signature text PRIMARY KEY,
 definition text NOT NULL,
 original_definition_hash text NOT NULL,
 wrapped_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.read_plan_originals_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.read_plan_originals_v1 FROM PUBLIC,anon,authenticated,service_role;

DO $read_plans$
DECLARE spec record; fn record; wrapped text; before_owner oid; before_acl aclitem[];
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('public.get_public_tournament_hand_v2(uuid,uuid)','6dc47b78563dac17956b3d126d70604e'),
  ('public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)','676a869969b8c0b0af863112798562b9')
 ) s(signature,expected_hash) LOOP
  SELECT p.*,n.nspname,pg_get_function_arguments(p.oid) arguments,
   replace(pg_get_functiondef(p.oid),chr(13),'') definition INTO STRICT fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=spec.signature::regprocedure;
  IF md5(fn.definition)<>spec.expected_hash OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')
   OR fn.prorettype<>'jsonb'::regtype OR fn.proretset OR fn.provolatile<>'s' OR NOT fn.prosecdef
   OR fn.proisstrict OR fn.proparallel<>'u' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  THEN RAISE EXCEPTION 'public_read_plan_contract_drift: %',spec.signature; END IF;
  before_owner:=fn.proowner;before_acl:=fn.proacl;
  wrapped:='BEGIN RETURN ('||regexp_replace(fn.prosrc,';[[:space:]]*$','')||'); END;';
  EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' COST %s AS %L',
   fn.nspname,fn.proname,fn.arguments,fn.procost,wrapped);
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn.oid AND
   (p.proowner IS DISTINCT FROM before_owner OR p.proacl IS DISTINCT FROM before_acl))
  THEN RAISE EXCEPTION 'public_read_plan_owner_or_acl_changed'; END IF;
  INSERT INTO spectator_projection_v2.read_plan_originals_v1 VALUES(spec.signature,fn.definition,spec.expected_hash,
   (SELECT md5(replace(pg_get_functiondef(p.oid),chr(13),'')) FROM pg_proc p WHERE p.oid=fn.oid));
 END LOOP;
END $read_plans$;
COMMIT;
