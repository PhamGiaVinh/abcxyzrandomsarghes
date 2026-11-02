BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $$ DECLARE f record;response jsonb;rejected boolean;seen integer:=0;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure))='2f4a64f991f4f2b2caf0b10002cdf93c';
 FOR f IN SELECT * FROM floor_private.fnb_create_cancel_fences_v1
  WHERE club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01' AND actor_id='a364de8e-06b1-4428-a20d-ac614ec406e5'
   AND request_id IN('432523af-d601-4297-935c-7f2b6d987bdc','ae9fee6b-792a-4cf1-aeb3-0fbf053a20db') LOOP
  seen:=seen+1;rejected:=false;
  ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=f.club_id AND client_request_id=f.request_id);
  ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_create_intents_v1 WHERE club_id=f.club_id AND request_id=f.request_id);
  PERFORM set_config('request.jwt.claim.sub',f.actor_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor_id,'role','authenticated')::text,true);
  BEGIN
   PERFORM set_config('role','authenticated',true);
   IF f.operation='comp' THEN
    response:=public.fnb_create_comp_order(f.club_id,'counter',f.payload->>'table',f.payload->>'customer',f.payload->>'note',f.payload->'lines',f.payload->>'reason',f.request_id);
   ELSE
    response:=public.fnb_create_order(f.club_id,'counter',f.payload->>'table',f.payload->>'customer',f.payload->>'note',f.payload->'lines',f.request_id,NULL,NULL);
   END IF;
   -- Existing writer API may return an explicit JSON business rejection.
   rejected:=response='{"error":"REQUEST_ID_CONFLICT"}'::jsonb;
  EXCEPTION WHEN OTHERS THEN
   ASSERT SQLERRM='REQUEST_ID_CONFLICT','late writer wrong rejection: '||SQLERRM;
   rejected:=true;
  END;
  PERFORM set_config('role','none',true);
  ASSERT rejected,'late writer accepted cancelled intent: '||coalesce(response::text,'null');
  ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=f.club_id AND client_request_id=f.request_id);
  ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_create_intents_v1 WHERE club_id=f.club_id AND request_id=f.request_id);
 END LOOP;
 ASSERT seen=2;
 ASSERT (SELECT on_hand=14 FROM public.fnb_ingredients WHERE id=(SELECT (fixture->>'ingredient')::uuid FROM floor_private.fnb731_browser_fixture));
END $$;
ROLLBACK;
SELECT 'FNB742_ACTUAL_BROWSER_NORMAL_AND_COMP_CANCEL_FENCES_REJECT_LATE_WRITERS_NO_ORDER_INTENT_STOCK_DELTA_PASS';
