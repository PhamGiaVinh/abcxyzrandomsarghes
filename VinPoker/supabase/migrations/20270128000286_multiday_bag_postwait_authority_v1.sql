-- CLI generated20261024211157, forward286 after catalog collision check.
-- Current authority after day/bag waits; stale isolation cannot prove revocation.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE r record; definition text; authority text; marker text; seam text; expected text;
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000286')
 THEN RAISE EXCEPTION 'MULTIDAY286_CATALOG_COLLISION';END IF;
 FOR r IN SELECT p.*,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid IN(
 'public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure,
 'public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)'::regprocedure,
 'public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure) LOOP
  IF md5(r.definition)<>(CASE r.proname
   WHEN 'multi_day_record_bag_v1' THEN '5938545dae6c953a7cabe3b090f0b9b2'
   WHEN 'multi_day_seal_bag_v1' THEN 'ab84f532a19974d961319fb3f64e8a0f'
   ELSE '4085443a5cb28264f71311e57681d4af' END)
  THEN RAISE EXCEPTION 'MULTIDAY286_SOURCE_DRIFT';END IF;
  marker:=CASE r.proname WHEN 'multi_day_record_bag_v1' THEN 'multi_day_bag_actor_not_allowed'
   WHEN 'multi_day_seal_bag_v1' THEN 'multi_day_bag_seal_actor_not_allowed'
   ELSE 'multi_day_close_actor_not_allowed' END;
  authority:=substring(r.definition FROM '( IF (?:v_actor IS DISTINCT FROM v_roster.dealer_user_id|NOT EXISTS)[\s\S]*?RAISE EXCEPTION '''||marker||''' USING ERRCODE=''42501'';\n END IF;)');
  IF authority IS NULL THEN RAISE EXCEPTION 'MULTIDAY286_AUTHORITY_SEAM_DRIFT';END IF;
  seam:=chr(10)||'BEGIN'||chr(10);
  IF (length(r.definition)-length(replace(r.definition,seam,'')))/length(seam)<>1
  THEN RAISE EXCEPTION 'MULTIDAY286_BEGIN_SEAM_DRIFT';END IF;
  definition:=replace(r.definition,seam,seam||
   ' IF current_setting(''transaction_isolation'')<>''read committed'' THEN'||chr(10)||
   '   RAISE EXCEPTION ''multi_day_bag_requires_read_committed'' USING ERRCODE=''40001'';'||chr(10)||' END IF;'||chr(10));
  seam:=' SELECT * INTO v_prior';
  IF (length(definition)-length(replace(definition,seam,'')))/length(seam)<>1
  THEN RAISE EXCEPTION 'MULTIDAY286_RECEIPT_SEAM_DRIFT';END IF;
  definition:=replace(definition,seam,authority||chr(10)||seam);
  IF r.proname='multi_day_record_bag_v1' THEN
   -- Keep FOUND tied to bag SELECT, not authorization subqueries.
   definition:=replace(definition,' IF FOUND THEN'||chr(10)||'   IF v_bag.sealed',
    ' IF FOUND THEN'||chr(10)||authority||chr(10)||'   IF v_bag.sealed');
   definition:=replace(definition,' ELSE'||chr(10)||'   IF p_expected_revision<>0',
    ' ELSE'||chr(10)||authority||chr(10)||'   IF p_expected_revision<>0');
  ELSIF r.proname='multi_day_seal_bag_v1' THEN
   definition:=replace(definition,' IF v_bag.total_value IS DISTINCT',authority||chr(10)||' IF v_bag.total_value IS DISTINCT');
  END IF;
  EXECUTE definition;
  expected:=CASE r.proname WHEN 'multi_day_record_bag_v1' THEN 'b3f7a522bb08cb27e4a60acf198bd21a'
   WHEN 'multi_day_seal_bag_v1' THEN '22bb35dc2f42228648d8c853273ef7fe'
   ELSE '94a1f794956258bc41f2998d41b4bb42' END;
  IF md5(pg_get_functiondef(r.oid))<>expected OR NOT(SELECT proowner=r.proowner AND proacl IS NOT DISTINCT FROM r.proacl
   AND proconfig IS NOT DISTINCT FROM r.proconfig AND prosecdef=r.prosecdef FROM pg_proc WHERE oid=r.oid)
   OR NOT has_function_privilege('authenticated',r.oid,'EXECUTE')
   OR has_function_privilege('anon',r.oid,'EXECUTE') OR has_function_privilege('service_role',r.oid,'EXECUTE')
  THEN RAISE EXCEPTION 'MULTIDAY286_POSTCONDITION_FAILED % % expected %',r.proname,md5(pg_get_functiondef(r.oid)),expected;END IF;
 END LOOP;
END $patch$;
COMMIT;
