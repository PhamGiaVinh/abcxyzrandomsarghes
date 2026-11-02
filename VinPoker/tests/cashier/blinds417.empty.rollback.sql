\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE original jsonb; payload jsonb; denied boolean; BEGIN
 SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO original FROM public.tournament_levels l WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e';
 ASSERT jsonb_array_length(original)>0,'fixture must have an existing structure';
 FOREACH payload IN ARRAY ARRAY['[]'::jsonb,NULL::jsonb,'null'::jsonb,'{}'::jsonb,'1'::jsonb] LOOP
  denied:=false;
  BEGIN
   PERFORM public.update_blind_structure('c367013a-3ed3-48af-ad48-3915acadc50e',payload);
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='blind_structure_empty_or_invalid';denied:=true;END;
  ASSERT denied,'BLINDS417_EMPTY_OR_NONARRAY_ACCEPTED:'||coalesce(payload::text,'SQLNULL');
  ASSERT original=(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 END LOOP;
 RAISE NOTICE 'BLINDS417_FIVE_BAD_SHAPES_DENIED_ORIGINAL_LEVELS_UNCHANGED_PASS';
END $$;
ROLLBACK;
