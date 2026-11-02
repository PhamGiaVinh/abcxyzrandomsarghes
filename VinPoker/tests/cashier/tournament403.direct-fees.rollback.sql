\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE col text; value bigint; high bigint; denied boolean; changed integer; original jsonb; new_id uuid; BEGIN
 SELECT to_jsonb(t) INTO STRICT original FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
 FOREACH col IN ARRAY ARRAY['buy_in','rake_amount','service_fee_amount'] LOOP
  FOREACH value IN ARRAY ARRAY[-1::bigint,9007199254740992::bigint] LOOP
   denied:=false;
   BEGIN EXECUTE format('UPDATE public.tournaments SET %I=$1 WHERE id=$2',col)
    USING value,'c367013a-3ed3-48af-ad48-3915acadc50e'::uuid;
    GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1;
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_money_invalid';denied:=true;
    WHEN numeric_value_out_of_range THEN denied:=true;END;
   ASSERT denied,format('direct403_invalid_%s_accepted:%s',col,value);
   denied:=false;
   BEGIN
    INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
     original||jsonb_build_object('id',gen_random_uuid(),'name','LOCAL403 rollback invalid fee',col,value))).*;
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tournament_money_invalid';denied:=true;
    WHEN numeric_value_out_of_range THEN denied:=true;END;
   ASSERT denied,'direct403_invalid_insert_accepted';
  END LOOP;
  denied:=false;
  BEGIN EXECUTE format('UPDATE public.tournaments SET %I=NULL WHERE id=$1',col) USING 'c367013a-3ed3-48af-ad48-3915acadc50e'::uuid;
  EXCEPTION WHEN not_null_violation THEN denied:=true;END;
  ASSERT denied,'direct403_existing_not_null_constraint_lost';
  high:=CASE WHEN col='rake_amount' THEN 2147483647::bigint ELSE 9007199254740991::bigint END;
  FOREACH value IN ARRAY ARRAY[0::bigint,100000::bigint,high] LOOP
   BEGIN
    EXECUTE format('UPDATE public.tournaments SET %I=$1 WHERE id=$2',col) USING value,'c367013a-3ed3-48af-ad48-3915acadc50e'::uuid;
    GET DIAGNOSTICS changed=ROW_COUNT;ASSERT changed=1;
    new_id:=gen_random_uuid();
    INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
     original||jsonb_build_object('id',new_id,'name','LOCAL403 rollback valid fee',col,value))).*;
    EXECUTE format('SELECT %I=$1 FROM public.tournaments WHERE id=$2',col) INTO denied USING value,new_id;
    ASSERT denied,'direct403_valid_insert_missing';
    RAISE EXCEPTION USING ERRCODE='ZX403',MESSAGE='rollback valid fee';
   EXCEPTION WHEN SQLSTATE 'ZX403' THEN NULL;END;
  END LOOP;
 END LOOP;
 ASSERT original=(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e');
 RAISE NOTICE 'DIRECT403_THREE_FEE_COLUMNS_BAD_INSERT_UPDATE12_NULL3_VALID_INSERT_UPDATE18_ORIGINAL_ROW_UNCHANGED_PASS';
END $$;
ROLLBACK;
