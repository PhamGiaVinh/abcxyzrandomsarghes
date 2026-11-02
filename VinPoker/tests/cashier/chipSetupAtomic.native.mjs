import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01';
export function runChipSetupAtomic(sql){
  const source=readFileSync('supabase/migrations/20270128000171_chip_setup_create_bind_receipts_v1.sql','utf8');
  for(const match of source.matchAll(/CREATE FUNCTION (private|public)\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g)){
    const args=match[2]==='apply_chip_setup_intent_v1'?'uuid,text,uuid,uuid,boolean':'uuid,text,uuid,uuid';
    assert.equal(sql(`SELECT replace(prosrc,chr(13),'') FROM pg_proc WHERE oid='${match[1]}.${match[2]}(${args})'::regprocedure;`).trim(),match[3].replaceAll('\r','').trim(),'qualified function body differs from candidate source');
  }
  const outsider=randomUUID(),tag=randomUUID();
  const snapshot=()=>sql(`SELECT jsonb_build_array((SELECT count(*) FROM public.tournaments),
    (SELECT count(*) FROM public.chip_set),(SELECT count(*) FROM public.tournament_chip_set),
    (SELECT count(*) FROM private.chip_setup_create_bind_receipts_v1),
    (SELECT count(*) FROM public.chip_inventory_ledger),(SELECT count(*) FROM public.chip_bank_ledger))::text;`);
  const before=snapshot();
  const result=JSON.parse(sql(`BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users(id) VALUES('${outsider}');
    SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
    CREATE FUNCTION pg_temp.setup_tour(n text) RETURNS uuid LANGUAGE plpgsql AS $$
    DECLARE r jsonb;BEGIN
      r:=public.create_tournament_with_levels_v1('${club}',jsonb_build_object('name',n,'start_time',now()+interval '1 hour',
        'buy_in',100000,'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
        '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');
      IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_tour_create:%',r;END IF;
      RETURN (r->>'tournament_id')::uuid;
    END $$;
    CREATE FUNCTION pg_temp.chip_setup_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('vinpoker.chip_setup_fault',true)='on' AND EXISTS(
        SELECT 1 FROM public.chip_set s WHERE s.id=NEW.chip_set_id AND s.name='Fault ${tag}'
      ) THEN RAISE EXCEPTION 'chip_setup_test_injected_binding_fault';END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER chip_setup171_test_fault BEFORE INSERT ON public.tournament_chip_set
      FOR EACH ROW EXECUTE FUNCTION pg_temp.chip_setup_fault();
    CREATE FUNCTION pg_temp.run_chip_setup() RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE t uuid;t2 uuid;t3 uuid;k uuid:=gen_random_uuid();cancel_key uuid:=gen_random_uuid();fault_key uuid:=gen_random_uuid();rejected_key uuid:=gen_random_uuid();name_key uuid:=gen_random_uuid();
      r jsonb;again jsonb;denied boolean;before_sets bigint;set_id uuid;
    BEGIN
      t:=pg_temp.setup_tour('Atomic chip Setup TEST');
      t2:=pg_temp.setup_tour('Cancelled chip Setup TEST');
      t3:=pg_temp.setup_tour('Fault chip Setup TEST');
      IF public.get_chip_setup_create_bind_receipt_v1(t,'Atomic ${tag}',k,'${actor}') IS NOT NULL THEN RAISE EXCEPTION 'unknown_receipt_not_null';END IF;
      r:=public.chip_ops_create_and_bind_set_v1(t,'Atomic ${tag}',k,'${actor}');
      IF r->>'outcome' IS DISTINCT FROM 'created_bound' OR r->>'status' IS DISTINCT FROM 'ok' OR r->>'actor_id' IS DISTINCT FROM '${actor}'
        OR r->>'tournament_id' IS DISTINCT FROM t::text OR r->>'club_id' IS DISTINCT FROM '${club}' THEN RAISE EXCEPTION 'bad_created_receipt:%',r;END IF;
      set_id:=(r->>'chip_set_id')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.tournament_chip_set WHERE tournament_id=t AND chip_set_id=set_id AND club_id='${club}') THEN RAISE EXCEPTION 'binding_not_committed';END IF;
      IF public.chip_ops_create_and_bind_set_v1(t,'Atomic ${tag}',k,'${actor}') IS DISTINCT FROM r
        OR public.get_chip_setup_create_bind_receipt_v1(t,'Atomic ${tag}',k,'${actor}') IS DISTINCT FROM r
        OR public.cancel_chip_setup_create_bind_v1(t,'Atomic ${tag}',k,'${actor}') IS DISTINCT FROM r THEN RAISE EXCEPTION 'replay_lookup_or_cancel_changed_commit';END IF;
      denied:=false;BEGIN PERFORM public.chip_ops_create_and_bind_set_v1(t,'Changed name',k,'${actor}');
        EXCEPTION WHEN invalid_parameter_value THEN denied:=SQLERRM='chip_setup_request_payload_conflict';END;
      IF NOT denied THEN RAISE EXCEPTION 'same_key_payload_conflict_missing';END IF;

      SELECT count(*) INTO before_sets FROM public.chip_set;
      again:=public.chip_ops_create_and_bind_set_v1(t,'Stale ${tag}',rejected_key,'${actor}');
      IF again->>'outcome' IS DISTINCT FROM 'rejected' OR again->>'error' IS DISTINCT FROM 'CHIP_SET_ALREADY_BOUND_RELOAD'
        OR (SELECT count(*) FROM public.chip_set)<>before_sets THEN RAISE EXCEPTION 'bound_tour_created_orphan';END IF;
      IF public.get_chip_setup_create_bind_receipt_v1(t,'Stale ${tag}',rejected_key,'${actor}') IS DISTINCT FROM again
        OR public.chip_ops_create_and_bind_set_v1(t,'Stale ${tag}',rejected_key,'${actor}') IS DISTINCT FROM again THEN RAISE EXCEPTION 'rejected_receipt_not_durable';END IF;
      r:=public.cancel_chip_setup_create_bind_v1(t2,'Cancelled ${tag}',cancel_key,'${actor}');
      IF r->>'outcome' IS DISTINCT FROM 'cancelled' OR r->'chip_set_id' IS DISTINCT FROM 'null'::jsonb
        OR public.chip_ops_create_and_bind_set_v1(t2,'Cancelled ${tag}',cancel_key,'${actor}') IS DISTINCT FROM r THEN RAISE EXCEPTION 'cancel_did_not_fence_late_create';END IF;
      IF EXISTS(SELECT 1 FROM public.tournament_chip_set WHERE tournament_id=t2) THEN RAISE EXCEPTION 'cancel_created_binding';END IF;
      r:=public.chip_ops_create_and_bind_set_v1(t2,'Atomic ${tag}',name_key,'${actor}');
      IF r->>'outcome' IS DISTINCT FROM 'rejected' OR r->>'error' IS DISTINCT FROM 'NAME_EXISTS'
        OR r->'chip_set_id' IS DISTINCT FROM 'null'::jsonb OR (SELECT count(*) FROM public.chip_set)<>before_sets
        OR EXISTS(SELECT 1 FROM public.tournament_chip_set WHERE tournament_id=t2)
        OR public.get_chip_setup_create_bind_receipt_v1(t2,'Atomic ${tag}',name_key,'${actor}') IS DISTINCT FROM r THEN
          RAISE EXCEPTION 'primitive_business_rejection_not_atomic_and_durable';END IF;

      PERFORM set_config('vinpoker.chip_setup_fault','on',true);
      denied:=false;BEGIN PERFORM public.chip_ops_create_and_bind_set_v1(t3,'Fault ${tag}',fault_key,'${actor}');
        EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='chip_setup_test_injected_binding_fault';END;
      IF NOT denied OR EXISTS(SELECT 1 FROM public.chip_set WHERE name='Fault ${tag}')
        OR public.get_chip_setup_create_bind_receipt_v1(t3,'Fault ${tag}',fault_key,'${actor}') IS NOT NULL THEN RAISE EXCEPTION 'fault_left_partial_create_or_receipt';END IF;
      PERFORM set_config('vinpoker.chip_setup_fault','off',true);
      r:=public.chip_ops_create_and_bind_set_v1(t3,'Fault ${tag}',fault_key,'${actor}');
      IF r->>'outcome' IS DISTINCT FROM 'created_bound' THEN RAISE EXCEPTION 'same_key_retry_after_rollback_failed';END IF;

      denied:=false;BEGIN PERFORM public.chip_ops_create_and_bind_set_v1(t2,'Wrong actor',gen_random_uuid(),'${outsider}');
        EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
      IF NOT denied THEN RAISE EXCEPTION 'expected_actor_fence_missing';END IF;
      PERFORM set_config('request.jwt.claim.sub','${outsider}',true);
      PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${outsider}"}',true);
      denied:=false;BEGIN PERFORM public.chip_ops_create_and_bind_set_v1(t2,'Outsider',gen_random_uuid(),'${outsider}');
        EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
      IF NOT denied THEN RAISE EXCEPTION 'outsider_create_allowed';END IF;
      denied:=false;BEGIN PERFORM public.get_chip_setup_create_bind_receipt_v1(t,'Atomic ${tag}',k,'${outsider}');
        EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
      IF NOT denied THEN RAISE EXCEPTION 'outsider_receipt_allowed';END IF;
      denied:=false;BEGIN PERFORM count(*) FROM private.chip_setup_create_bind_receipts_v1;
        EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
      IF NOT denied THEN RAISE EXCEPTION 'direct_private_receipt_read_allowed';END IF;
      RETURN jsonb_build_object('created',true,'replay',true,'conflict',true,'cancel',true,'faultRollback',true,'outsider',true);
    END $$;
    SET LOCAL ROLE authenticated;SELECT pg_temp.run_chip_setup();ROLLBACK;`));
  assert.deepEqual(result,{created:true,replay:true,conflict:true,cancel:true,faultRollback:true,outsider:true});
  assert.equal(snapshot(),before);assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${outsider}');`),'f');
  for(const name of ['chip_ops_create_and_bind_set_v1','get_chip_setup_create_bind_receipt_v1','cancel_chip_setup_create_bind_v1']){
    assert.equal(sql(`SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.${name}(uuid,text,uuid,uuid)'::regprocedure;`),'t');
    assert.equal(sql(`SELECT has_function_privilege('authenticated','public.${name}(uuid,text,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.${name}(uuid,text,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.${name}(uuid,text,uuid,uuid)','EXECUTE');`),'t');
  }
  assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='private.chip_setup_create_bind_receipts_v1'::regclass;"),'t');
  console.log('CHIP_SETUP171_ATOMIC_REPLAY_CONFLICT_CANCEL_FAULT_ACTOR_ROLLBACK_PASS');
}

export async function runChipSetupAtomicOverlap({sql,session,until}){
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
  const createTour=()=>{
    const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.create_tournament_with_levels_v1('${club}',
      jsonb_build_object('name','Chip atomic overlap local TEST','start_time',now()+interval '1 hour','buy_in',100000,
      'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
      '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');COMMIT;`));
    assert.equal(r.ok,true);return r.tournament_id;
  };
  const result=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
  for(const order of ['create-first','cancel-first','different-keys','legacy-first','composite-first']){
    const tour=createTour(),key=randomUUID(),nextKey=order==='different-keys'?randomUUID():key;
    const name='Atomic '+key,secondName=order==='different-keys'?'Second '+nextKey:name;
    const call=(cancel=false,request=key,label=name)=>`public.${cancel?'cancel_chip_setup_create_bind_v1':'chip_ops_create_and_bind_set_v1'}('${tour}','${label}','${request}','${actor}')`;
    let legacySet=null;
    if(order.includes('legacy')||order==='composite-first'){
      const legacy=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_create_chip_set('${club}','Legacy ${key}');COMMIT;`));
      assert.equal(legacy.status,'ok');legacySet=legacy.chip_set_id;
    }
    let holder,waiter,conflict;
    try{
      const first=order==='legacy-first'?`public.chip_ops_bind_tournament_chip_set('${tour}','${legacySet}')`:call(order==='cancel-first');
      const second=order==='composite-first'?`public.chip_ops_bind_tournament_chip_set('${tour}','${legacySet}')`:call(order==='create-first',nextKey,secondName);
      holder=session('chip171_holder');
      holder.child.stdin.write(`BEGIN;${auth}SELECT 'RESULT:'||(${first})::text;\n\\echo CHIP_HELD\n`);
      await until(()=>holder.output().includes('CHIP_HELD'));
      const initial=result(holder.output());
      if(!['legacy-first'].includes(order)){
        // A successful NULL read while writer holds an uncommitted receipt is
        // UNKNOWN, not evidence of rollback; client must preserve its nonce.
        assert.equal(sql(`BEGIN;${auth}SELECT coalesce(public.get_chip_setup_create_bind_receipt_v1('${tour}','${name}','${key}','${actor}'),'null'::jsonb);ROLLBACK;`),'null');
      }
      waiter=session('chip171_waiter');
      waiter.child.stdin.end(`BEGIN;${auth}SELECT 'RESULT:'||(${second})::text;COMMIT;\n`);
      await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='chip171_waiter' AND wait_event_type='Lock');")==='t');
      if(order==='create-first'){
        conflict=session('chip171_conflict');
        conflict.child.stdin.end(`BEGIN;${auth}SELECT ${call(false,key,'Conflicting '+key)};COMMIT;\n`);
        await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='chip171_conflict' AND wait_event_type='Lock');")==='t');
      }
      holder.child.stdin.end('COMMIT;\n');await holder.closed;
      if(order==='composite-first'){
        await assert.rejects(waiter.closed,/duplicate key|unique constraint/);
        assert.equal(sql(`SELECT chip_set_id FROM public.tournament_chip_set WHERE tournament_id='${tour}';`),initial.chip_set_id);
      }else{
        const repeated=result(await waiter.closed);
        if(['create-first','cancel-first'].includes(order))assert.deepEqual(repeated,initial);
        else {assert.equal(repeated.outcome,'rejected');assert.equal(repeated.error,'CHIP_SET_ALREADY_BOUND_RELOAD');}
      }
      if(conflict)await assert.rejects(conflict.closed,/chip_setup_request_payload_conflict/);
      const expected=order==='cancel-first'?0:1;
      assert.equal(Number(sql(`SELECT count(*) FROM public.tournament_chip_set WHERE tournament_id='${tour}';`)),expected);
      assert.equal(Number(sql(`SELECT count(*) FROM public.chip_set WHERE club_id='${club}' AND name IN('${name}','${secondName}');`)),['cancel-first','legacy-first'].includes(order)?0:1,'orphan created during overlap');
      assert.equal(Number(sql(`SELECT count(*) FROM private.chip_setup_create_bind_receipts_v1 WHERE tournament_id='${tour}';`)),order==='different-keys'?2:1);
      console.log('CHIP_SETUP171_REAL_LOCK_'+order.toUpperCase().replaceAll('-','_')+'_PASS',JSON.stringify({tour,key,legacySet,outcome:initial.outcome??initial.action,retained:'synthetic metadata and immutable receipts, no issue/payment'}));
    }finally{
      for(const handle of [holder,waiter,conflict])if(handle){
        if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
        await handle.closed.catch(()=>{});
      }
    }
  }
}
