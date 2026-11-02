-- CLI generated20261024203514, forward285 after284/catalog check.
-- Read-only terminal archive projection; no receipt, entry, payment or seating mutation.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $patch$ DECLARE definition text;prior record;seam record;
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000285')
 THEN RAISE EXCEPTION 'CASHIER285_CATALOG_COLLISION';END IF;
 SELECT * INTO STRICT prior FROM pg_proc WHERE oid='public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer)'::regprocedure;
 definition:=pg_get_functiondef(prior.oid);
 IF md5(definition)<>'6ffe6a9e0fd924ee30f5ea92e7a213b1' THEN RAISE EXCEPTION 'CASHIER285_WORKLIST_DRIFT';END IF;
 FOR seam IN SELECT * FROM (VALUES
  ('v_result jsonb;','v_result jsonb; v_terminal boolean;'),
  ('  IF p_page IS NULL','  v_terminal:=(SELECT t.status IN(''completed'',''cancelled'') FROM public.tournaments t WHERE t.id=p_tournament_id AND t.club_id=p_club_id);'||chr(10)||'  IF p_page IS NULL'),
  ('receipt.receipt_code,receipt.table_number,receipt.seat_number,','receipt.receipt_code,receipt.table_number,receipt.seat_number,v_terminal AS receipt_is_historical,'),
  ('s.status IN (''issued'',''printed'')','(s.status IN (''issued'',''printed'') OR (v_terminal AND s.status=''superseded''))')
 )s(anchor,replacement) LOOP
  IF (length(definition)-length(replace(definition,seam.anchor,'')))/length(seam.anchor)<>1 THEN RAISE EXCEPTION 'CASHIER285_SEAM_DRIFT';END IF;
  definition:=replace(definition,seam.anchor,seam.replacement);
 END LOOP;
 EXECUTE definition;
 IF md5(pg_get_functiondef(prior.oid))<>'6a408d9aedd50d07b83cd6643d6e3732'
  OR NOT(SELECT proowner=prior.proowner AND proacl IS NOT DISTINCT FROM prior.proacl
   AND proconfig IS NOT DISTINCT FROM prior.proconfig AND prosecdef=prior.prosecdef FROM pg_proc WHERE oid=prior.oid)
  OR NOT has_function_privilege('authenticated',prior.oid,'EXECUTE')
  OR has_function_privilege('anon',prior.oid,'EXECUTE')
  OR has_function_privilege('service_role',prior.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'CASHIER285_AUTHORITY_CHANGED';END IF;
END $patch$;
COMMIT;
