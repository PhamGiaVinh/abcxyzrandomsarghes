-- The existing SQL reader coerced bigint buy_in to its numeric output column.
-- Preserve that coercion in the prepared PL/pgSQL RETURN QUERY reader.
-- No clock rules, source values, money writes, visibility or ACL changes.
-- Recovery: tests/publicHud/clock-numeric.forward-rollback.sql before032.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE spectator_projection_v2.clock_numeric_original_v1 (
 signature text PRIMARY KEY CHECK(signature='public.get_public_tournament_clock_summary(uuid)'),
 definition text NOT NULL,
 original_definition_hash text NOT NULL,
 candidate_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.clock_numeric_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.clock_numeric_original_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $clock_numeric$
DECLARE target_signature constant text:='public.get_public_tournament_clock_summary(uuid)';
 expected_hash constant text:='0996e504a583390a6ac36cad27937378';
 body text; rewritten text; before_metadata jsonb;
 needle constant text:='t.guarantee_amount,t.buy_in,';
BEGIN
 body:=replace(pg_get_functiondef(target_signature::regprocedure),chr(13),'');
 IF md5(body)<>expected_hash
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target_signature::regprocedure
  AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'
  AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND prosecdef AND provolatile='s'
  AND proconfig=ARRAY['search_path=""']::text[])
 OR NOT EXISTS(SELECT 1 FROM spectator_projection_v2.clock_counts_original_v1 c
  WHERE c.signature=target_signature AND c.candidate_definition_hash=expected_hash)
 OR (length(body)-length(replace(body,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'clock_numeric_preimage_differs';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=target_signature::regprocedure;
 rewritten:=replace(body,needle,'t.guarantee_amount,t.buy_in::numeric,');
 EXECUTE rewritten;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target_signature::regprocedure) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'clock_numeric_metadata_changed';END IF;
 INSERT INTO spectator_projection_v2.clock_numeric_original_v1 VALUES(target_signature,body,expected_hash,
  md5(replace(pg_get_functiondef(target_signature::regprocedure),chr(13),'')));
END $clock_numeric$;
COMMIT;
