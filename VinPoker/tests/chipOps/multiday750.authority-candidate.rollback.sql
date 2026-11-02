-- LOCAL candidate qualification only. No migration/ledger/install; always ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $guard$;
CREATE TEMP TABLE authority750_before AS
 SELECT oid,proowner,proacl,proconfig,prosecdef,pg_get_functiondef(oid) AS definition
 FROM pg_proc WHERE oid IN(
 'public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure,
 'public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)'::regprocedure,
 'public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure);
DO $candidate$
DECLARE r record; definition text; authority text; marker text;
BEGIN
 FOR r IN SELECT b.*,p.proname FROM authority750_before b JOIN pg_proc p USING(oid) LOOP
  ASSERT md5(r.definition)=CASE r.proname
   WHEN 'multi_day_record_bag_v1' THEN '5938545dae6c953a7cabe3b090f0b9b2'
   WHEN 'multi_day_seal_bag_v1' THEN 'ab84f532a19974d961319fb3f64e8a0f'
   ELSE '4085443a5cb28264f71311e57681d4af' END,'candidate source drift';
  marker:=CASE r.proname WHEN 'multi_day_record_bag_v1' THEN 'multi_day_bag_actor_not_allowed'
   WHEN 'multi_day_seal_bag_v1' THEN 'multi_day_bag_seal_actor_not_allowed'
   ELSE 'multi_day_close_actor_not_allowed' END;
  authority:=substring(r.definition FROM '( IF (?:v_actor IS DISTINCT FROM v_roster.dealer_user_id|NOT EXISTS)[\s\S]*?RAISE EXCEPTION '''||marker||''' USING ERRCODE=''42501'';\n END IF;)');
  ASSERT authority IS NOT NULL,'authority seam missing';
  definition:=replace(r.definition,chr(10)||'BEGIN'||chr(10),chr(10)||'BEGIN'||chr(10)||
   ' IF current_setting(''transaction_isolation'')<>''read committed'' THEN'||chr(10)||
   '   RAISE EXCEPTION ''multi_day_bag_requires_read_committed'' USING ERRCODE=''40001'';'||chr(10)||' END IF;'||chr(10));
  -- Recheck after day wait, before replay. Record/seal also wait for a bag row.
  ASSERT strpos(definition,' SELECT * INTO v_prior')>0;
  definition:=replace(definition,' SELECT * INTO v_prior',authority||chr(10)||' SELECT * INTO v_prior');
  IF r.proname='multi_day_record_bag_v1' THEN
   -- FOUND must still refer to the bag SELECT; put check inside each branch.
   definition:=replace(definition,' IF FOUND THEN'||chr(10)||'   IF v_bag.sealed',
    ' IF FOUND THEN'||chr(10)||authority||chr(10)||'   IF v_bag.sealed');
   definition:=replace(definition,' ELSE'||chr(10)||'   IF p_expected_revision<>0',
    ' ELSE'||chr(10)||authority||chr(10)||'   IF p_expected_revision<>0');
  ELSIF r.proname='multi_day_seal_bag_v1' THEN
   -- Evaluate FOUND guard first; authority check itself performs SELECTs.
   definition:=replace(definition,' IF v_bag.total_value IS DISTINCT',authority||chr(10)||' IF v_bag.total_value IS DISTINCT');
  END IF;
  EXECUTE definition;
  ASSERT (SELECT proowner=r.proowner AND proacl IS NOT DISTINCT FROM r.proacl
   AND proconfig IS NOT DISTINCT FROM r.proconfig AND prosecdef=r.prosecdef FROM pg_proc WHERE oid=r.oid),'authority changed';
 END LOOP;
END $candidate$;
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(allowed_club_ids||ARRAY['2d6ff316-9ca6-4aa5-8c6e-7bc9982f4abd'::uuid])x) WHERE id;
SET LOCAL request.jwt.claim.sub='fe1d1df9-de0f-4ae7-94a9-f880fc60637c';
SET LOCAL request.jwt.claims='{"sub":"fe1d1df9-de0f-4ae7-94a9-f880fc60637c","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SAVEPOINT positive_lifecycle;
DO $positive$
DECLARE receipt jsonb; replay jsonb; request uuid:=gen_random_uuid(); sealed jsonb; closed jsonb; version integer;
BEGIN
 receipt:=public.multi_day_record_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93','LOCAL750-CANDIDATE',20000,0,request);
 ASSERT receipt->>'ok'='true' AND receipt->>'revision'='1';
 replay:=public.multi_day_record_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93','LOCAL750-CANDIDATE',20000,0,request);
 ASSERT replay->>'idempotent'='true' AND replay->>'bagId'=receipt->>'bagId';
 BEGIN
  PERFORM public.multi_day_record_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93','DIFFERENT',20000,0,request);
  RAISE EXCEPTION 'candidate failed payload conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_bag_request_conflict';END;
 sealed:=public.multi_day_seal_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93',1,gen_random_uuid());
 ASSERT sealed->>'sealed'='true' AND sealed->>'revision'='2';
 SELECT d.version INTO version FROM public.day_close d WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND day_number=1;
 closed:=public.multi_day_close_bagging_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7',version,gen_random_uuid());
 ASSERT closed->>'status'='locked' AND closed->>'bagCount'='1' AND closed->>'countedTotal'='20000';
 RAISE NOTICE 'MULTIDAY750_CANDIDATE_RECORD_REPLAY_CONFLICT_SEAL_CLOSE_PASS_ROLLBACK_ONLY';
END $positive$;
ROLLBACK TO SAVEPOINT positive_lifecycle;
SET LOCAL request.jwt.claim.sub='502c571e-6e6d-42e1-b836-7e150e69b2ee';
SET LOCAL request.jwt.claims='{"sub":"502c571e-6e6d-42e1-b836-7e150e69b2ee","role":"authenticated"}';
DO $negative$
BEGIN
 BEGIN
  PERFORM public.multi_day_record_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93','LOCAL750-DENIED',20000,0,gen_random_uuid());
  RAISE EXCEPTION 'revoked record accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_bag_actor_not_allowed';END;
 BEGIN
  PERFORM public.multi_day_seal_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93',1,gen_random_uuid());
  RAISE EXCEPTION 'revoked seal accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_bag_seal_actor_not_allowed';END;
 BEGIN
  PERFORM public.multi_day_close_bagging_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7',0,gen_random_uuid());
  RAISE EXCEPTION 'revoked close accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_close_actor_not_allowed';END;
 RAISE NOTICE 'MULTIDAY750_CANDIDATE_REVOKED_ACTOR_DENIED_ALL_THREE';
END $negative$;
RESET ROLE;
ROLLBACK;
SELECT md5(pg_get_functiondef('public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure))='5938545dae6c953a7cabe3b090f0b9b2' AS original_body_retained,
 (SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7')=0 AS no_bag_committed;
