\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE value numeric; denied boolean; original jsonb; changed integer; new_id uuid; rejected integer:=0; accepted integer:=0; BEGIN
 SELECT to_jsonb(t) INTO STRICT original FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
 FOREACH value IN ARRAY ARRAY[-1::numeric,0.5::numeric,9007199254740992::numeric,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric] LOOP
  denied:=false;
  BEGIN
   UPDATE public.tournaments SET guarantee_amount=value WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_guarantee_invalid';denied:=true;END;
  ASSERT denied,format('guarantee401_invalid_update_accepted:%s',value);rejected:=rejected+1;
  denied:=false;
  BEGIN
   INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
    original||jsonb_build_object('id',gen_random_uuid(),'name','LOCAL401 rollback invalid GTD','guarantee_amount',value))).*;
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_guarantee_invalid';denied:=true;END;
  ASSERT denied,format('guarantee401_invalid_insert_accepted:%s',value);rejected:=rejected+1;
 END LOOP;
 FOREACH value IN ARRAY ARRAY[NULL::numeric,0::numeric,1::numeric,2500000::numeric,9007199254740991::numeric] LOOP
  BEGIN
   UPDATE public.tournaments SET guarantee_amount=value WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
   GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1;
   ASSERT (SELECT guarantee_amount FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e') IS NOT DISTINCT FROM value;
   new_id:=gen_random_uuid();
   INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
    original||jsonb_build_object('id',new_id,'name','LOCAL401 rollback valid GTD','guarantee_amount',value))).*;
   ASSERT (SELECT guarantee_amount FROM public.tournaments WHERE id=new_id) IS NOT DISTINCT FROM value;
   RAISE EXCEPTION USING ERRCODE='ZX401',MESSAGE='rollback valid GTD probe';
  EXCEPTION WHEN SQLSTATE 'ZX401' THEN NULL;END;
  accepted:=accepted+1;
 END LOOP;
 ASSERT original=(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT rejected=12 AND accepted=5;
 RAISE NOTICE 'GUARANTEE401_AUTH_UPDATE_INSERT_BAD12_VALID_UPDATE_INSERT10_ORIGINAL_ROW_UNCHANGED_PASS';
END $$;
RESET ROLE;
ROLLBACK;
