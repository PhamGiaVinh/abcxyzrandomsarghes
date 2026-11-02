\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441; END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE original jsonb; denied boolean:=false; changed integer; value integer; BEGIN
 SELECT to_jsonb(t) INTO STRICT original FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
 BEGIN
  UPDATE public.tournaments SET current_players=-1 WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
  GET DIAGNOSTICS changed=ROW_COUNT; ASSERT changed=1,'test owner is not authorized';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_player_count_invalid';denied:=true; END;
 ASSERT denied,'DIRECT410_NEGATIVE_CURRENT_PLAYERS_ACCEPTED';
 denied:=false;
 BEGIN
  INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
   original||jsonb_build_object('id',gen_random_uuid(),'name','LOCAL410 rollback invalid players','current_players',-1))).*;
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_player_count_invalid';denied:=true;END;
 ASSERT denied,'DIRECT410_NEGATIVE_INSERT_ACCEPTED';
 FOREACH value IN ARRAY ARRAY[NULL::integer,0,1,2147483647] LOOP
  BEGIN
   UPDATE public.tournaments SET current_players=value WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
   GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1;
   INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
    original||jsonb_build_object('id',gen_random_uuid(),'name','LOCAL410 rollback valid players','current_players',value))).*;
   RAISE EXCEPTION USING ERRCODE='ZX410',MESSAGE='rollback valid probe';
  EXCEPTION WHEN SQLSTATE 'ZX410' THEN NULL;END;
 END LOOP;
 ASSERT original=(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e');
 RAISE NOTICE 'DIRECT410_NEGATIVE_INSERT_UPDATE_DENIED_NULL_ZERO_MAX_VALID_ORIGINAL_UNCHANGED_PASS';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 UPDATE public.tournaments SET current_players=42 WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
 GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=0,'DIRECT410_OUTSIDER_CHANGED_COUNT';
 RAISE NOTICE 'DIRECT410_OUTSIDER_NO_DELTA_PASS';
END $$;
ROLLBACK;
