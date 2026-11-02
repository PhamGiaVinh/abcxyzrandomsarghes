\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE payload jsonb; rejected boolean; result jsonb; original jsonb; BEGIN
 SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO original FROM public.tournament_levels l WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';
 FOREACH payload IN ARRAY ARRAY[
  '{"level_number":1,"small_blind":-1,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}'::jsonb,
  '{"level_number":1,"small_blind":100,"big_blind":-1,"ante":0,"duration_minutes":20,"is_break":false}'::jsonb,
  '{"level_number":1,"small_blind":100,"big_blind":0,"ante":0,"duration_minutes":20,"is_break":false}'::jsonb,
  '{"level_number":1,"small_blind":100,"big_blind":200,"ante":-1,"duration_minutes":20,"is_break":false}'::jsonb,
  '{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":-1,"is_break":false}'::jsonb
 ] LOOP
  rejected:=false;
  BEGIN
   result:=public.update_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e',jsonb_build_array(payload));
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_blind_level_invalid';rejected:=true; END;
  ASSERT rejected,'BLINDS415_INVALID_RPC_LEVEL_ACCEPTED:'||payload::text;
  rejected:=false;
  BEGIN
   UPDATE public.tournament_levels SET small_blind=(payload->>'small_blind')::integer,
    big_blind=(payload->>'big_blind')::integer,ante=(payload->>'ante')::integer,
    duration_minutes=(payload->>'duration_minutes')::integer,is_break=(payload->>'is_break')::boolean
   WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_blind_level_invalid';rejected:=true;END;
  ASSERT rejected,'BLINDS415_INVALID_DIRECT_UPDATE_ACCEPTED';
  rejected:=false;
  BEGIN
   result:=public.import_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e',
    concat_ws(',',payload->>'small_blind',payload->>'big_blind',payload->>'ante',payload->>'duration_minutes',payload->>'is_break'));
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_blind_level_invalid';rejected:=true;END;
  ASSERT rejected,'BLINDS415_INVALID_CSV_ACCEPTED';
  ASSERT original IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 END LOOP;
 FOREACH payload IN ARRAY ARRAY[
  '{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}'::jsonb,
  '{"level_number":1,"small_blind":0,"big_blind":0,"ante":0,"duration_minutes":15,"is_break":true}'::jsonb,
  '{"level_number":1,"small_blind":0,"big_blind":1,"ante":0,"duration_minutes":0,"is_break":false}'::jsonb
 ] LOOP
  BEGIN
   result:=public.update_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e',jsonb_build_array(payload));
   ASSERT result->>'status'='success' AND (result->>'levels_saved')::integer=1;
   result:=public.import_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e',
    concat_ws(',',payload->>'small_blind',payload->>'big_blind',payload->>'ante',payload->>'duration_minutes',payload->>'is_break'));
   ASSERT result->>'status'='success' AND (result->>'levels_imported')::integer=1;
   RAISE EXCEPTION USING ERRCODE='ZX415',MESSAGE='rollback valid blind';
  EXCEPTION WHEN SQLSTATE 'ZX415' THEN NULL;END;
 END LOOP;
 RAISE NOTICE 'BLINDS415_INVALID15_RPC_DIRECT_CSV_ATOMIC_VALID6_EXISTING_SEMANTICS_PASS';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  PERFORM public.update_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e','[]');
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='blind_parent_actor_not_allowed';denied:=true;END;
 ASSERT denied,'BLINDS415_OUTSIDER_RPC_ACCEPTED';
 RAISE NOTICE 'BLINDS415_OUTSIDER_DENIED_PASS';
END $$;
ROLLBACK;
