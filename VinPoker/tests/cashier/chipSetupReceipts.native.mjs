import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseChipSetupReceipt} from '../../src/lib/chipSetupReceipt.ts';

export function runChipSetupReceipts(sql,{partialRepro=false,templateReplayRepro=false,templateV2=false,metadataReplayRepro=null}={}){
  let receiptCount;
  if(templateV2){
    receiptCount=sql('SELECT count(*) FROM private.chip_template_save_receipts_v1;');
    const source=readFileSync('supabase/migrations/20270128000176_chip_template_save_receipts_v1.sql','utf8');
    for(const match of source.matchAll(/CREATE FUNCTION (private|public)\.(\w+)\([\s\S]*?AS \$f\$([\s\S]*?)\$f\$/g)){
      const args='uuid,uuid,text,bigint,jsonb,uuid,uuid'+(match[2]==='resolve_chip_template_save_v1'?',text':'');
      assert.equal(sql(`SELECT replace(prosrc,chr(13),'') FROM pg_proc WHERE oid='${match[1]}.${match[2]}(${args})'::regprocedure;`).trim(),match[3].replaceAll('\r','').trim());
      const flags=JSON.parse(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
        'anon',has_function_privilege('anon',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'),
        'auth',has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE oid='${match[1]}.${match[2]}(${args})'::regprocedure;`));
      assert.deepEqual(flags,{owner:'postgres',definer:match[1]==='public',config:['search_path=""'],anon:false,service:false,auth:match[1]==='public'});
    }
    assert.equal(sql("SELECT relrowsecurity AND NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('authenticated',oid,'SELECT') AND NOT has_table_privilege('service_role',oid,'SELECT') FROM pg_class WHERE oid='private.chip_template_save_receipts_v1'::regclass;"),'t');
  }
  const counts=()=>sql(`SELECT jsonb_build_array((SELECT count(*) FROM public.tournaments),
    (SELECT count(*) FROM public.chip_set),(SELECT count(*) FROM public.chip_set_denomination),
    (SELECT count(*) FROM public.stack_template),(SELECT count(*) FROM public.chip_inventory_ledger),
    (SELECT count(*) FROM public.chip_bank_ledger))::text;`);
  const before=counts();
  const outsider=randomUUID();
  const result=JSON.parse(sql(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${outsider}');
    GRANT USAGE ON SCHEMA auth TO authenticated;
    SET LOCAL request.jwt.claim.sub='a364de8e-06b1-4428-a20d-ac614ec406e5';
    SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}';
    ${templateV2?`CREATE FUNCTION pg_temp.template_save_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_setting('vinpoker.template_save_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_TEMPLATE_LINE_FAULT';END IF;RETURN NEW;END $$;
      CREATE TRIGGER chip_template176_test_fault BEFORE INSERT ON public.stack_template_line FOR EACH ROW EXECUTE FUNCTION pg_temp.template_save_fault();`:''}
    CREATE FUNCTION pg_temp.chip_setup_receipts() RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE tour uuid;set_id uuid;denom uuid;unused uuid;created jsonb;bound jsonb;same jsonb;added jsonb;removed jsonb;saved jsonb;r jsonb;denied jsonb;
      nonce uuid:=gen_random_uuid();cancel_nonce uuid:=gen_random_uuid();receipt jsonb;lines jsonb;rejected jsonb;
      fault_nonce uuid:=gen_random_uuid();
      wrong_nonce uuid:=gen_random_uuid();second_denom uuid;ordered_lines jsonb;order_receipt jsonb;
    BEGIN
      r:=public.create_tournament_with_levels_v1('349ecf35-50ba-4c71-a581-15dc45f1cd01',
        jsonb_build_object('name','Setup receipt rollback local TEST','start_time',now()+interval '1 hour',
        'buy_in',100000,'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
        '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',
        gen_random_uuid(),'a364de8e-06b1-4428-a20d-ac614ec406e5');
      IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'setup_create_tour_failed:%',r;END IF;
      tour:=(r->>'tournament_id')::uuid;
      created:=public.chip_ops_create_chip_set('349ecf35-50ba-4c71-a581-15dc45f1cd01','Setup receipt TEST '||gen_random_uuid());
      set_id:=(created->>'chip_set_id')::uuid;
      bound:=public.chip_ops_bind_tournament_chip_set(tour,set_id);
      same:=public.chip_ops_bind_tournament_chip_set(tour,set_id);
      added:=public.chip_ops_add_denomination(set_id,100,'red',NULL,0);
      IF ${metadataReplayRepro==='add'?'true':'false'} THEN
        r:=public.chip_ops_add_denomination(set_id,100,'red',NULL,0);
        IF r IS DISTINCT FROM added THEN RAISE EXCEPTION 'CHIP_METADATA_ADD_REPLAY_UNRESOLVED:%',r;END IF;
      END IF;
      denom:=(added->>'denomination_id')::uuid;
      r:=public.chip_ops_add_denomination(set_id,1000,'yellow',NULL,1);
      unused:=(r->>'denomination_id')::uuid;
      removed:=public.chip_ops_delete_denomination(unused);
      IF ${metadataReplayRepro==='delete'?'true':'false'} THEN
        r:=public.chip_ops_delete_denomination(unused);
        IF r IS DISTINCT FROM removed THEN RAISE EXCEPTION 'CHIP_METADATA_DELETE_REPLAY_UNRESOLVED:%',r;END IF;
      END IF;
      lines:=jsonb_build_array(jsonb_build_object('denomination_id',denom,'count',200));
      IF ${templateV2?'true':'false'} THEN
        IF public.get_chip_template_save_receipt_v1(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS NOT NULL THEN RAISE EXCEPTION 'new_nonce_has_receipt';END IF;
        receipt:=public.chip_ops_save_stack_template_v2(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        r:=public.chip_ops_save_stack_template_v2(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF r IS DISTINCT FROM receipt OR r->>'outcome' IS DISTINCT FROM 'saved' THEN RAISE EXCEPTION 'template_receipt_replay_invalid:%',r;END IF;
        IF public.get_chip_template_save_receipt_v1(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'template_receipt_lookup_invalid';END IF;
        IF public.cancel_chip_template_save_v1(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'cancel_rewrites_saved';END IF;
        BEGIN
          PERFORM public.chip_ops_save_stack_template_v2(tour,set_id,'DIFFERENT TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
          RAISE EXCEPTION 'different_payload_not_rejected';
        EXCEPTION WHEN invalid_parameter_value THEN
          IF SQLERRM<>'chip_template_request_payload_conflict' THEN RAISE;END IF;
        END;
        r:=public.cancel_chip_template_save_v1(tour,set_id,'CANCEL TEST',20000,lines,cancel_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF r->>'outcome' IS DISTINCT FROM 'cancelled' OR public.chip_ops_save_stack_template_v2(tour,set_id,'CANCEL TEST',20000,lines,cancel_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS DISTINCT FROM r THEN RAISE EXCEPTION 'cancel_fence_failed';END IF;
        rejected:=public.chip_ops_save_stack_template_v2(tour,set_id,'20k TEST',20000,lines,gen_random_uuid(),'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF rejected->>'outcome' IS DISTINCT FROM 'rejected' OR rejected->>'error' IS DISTINCT FROM 'NAME_EXISTS' THEN RAISE EXCEPTION 'new_nonce_name_conflict_invalid';END IF;
        IF (SELECT count(*) FROM public.stack_template WHERE tournament_id=tour)<>1 THEN RAISE EXCEPTION 'template_duplicate_after_retry';END IF;
        rejected:=public.chip_ops_save_stack_template_v2(tour,gen_random_uuid(),'WRONG SET TEST',20000,lines,wrong_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF rejected->>'error' IS DISTINCT FROM 'CHIP_SET_BINDING_CHANGED_RELOAD' OR rejected->>'outcome' IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'wrong_binding_not_rejected';END IF;
        BEGIN
          PERFORM public.chip_ops_save_stack_template_v2(tour,set_id,'INVALID TEST',20000,jsonb_build_array(jsonb_build_object('denomination_id',denom,'count',0.5)),gen_random_uuid(),'a364de8e-06b1-4428-a20d-ac614ec406e5');
          RAISE EXCEPTION 'fractional_count_not_rejected';
        EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'chip_template_invalid_lines' THEN RAISE;END IF;END;
        r:=public.chip_ops_add_denomination(set_id,1000,'yellow',NULL,1);second_denom:=(r->>'denomination_id')::uuid;
        ordered_lines:=jsonb_build_array(jsonb_build_object('denomination_id',denom,'count',100),jsonb_build_object('denomination_id',second_denom,'count',10));
        wrong_nonce:=gen_random_uuid();
        order_receipt:=public.chip_ops_save_stack_template_v2(tour,set_id,'ORDER TEST',20000,ordered_lines,wrong_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF order_receipt->>'outcome' IS DISTINCT FROM 'saved' OR public.chip_ops_save_stack_template_v2(tour,set_id,'ORDER TEST',20000,jsonb_build_array(ordered_lines->1,ordered_lines->0),wrong_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS DISTINCT FROM order_receipt THEN RAISE EXCEPTION 'reordered_lines_changed_identity';END IF;
        PERFORM set_config('vinpoker.template_save_fault','on',true);
        BEGIN
          PERFORM public.chip_ops_save_stack_template_v2(tour,set_id,'FAULT TEST',20000,lines,fault_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
          RAISE EXCEPTION 'line_fault_did_not_fire';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LOCAL_TEMPLATE_LINE_FAULT' THEN RAISE;END IF;END;
        IF EXISTS(SELECT 1 FROM public.stack_template WHERE tournament_id=tour AND name='FAULT TEST')
          OR public.get_chip_template_save_receipt_v1(tour,set_id,'FAULT TEST',20000,lines,fault_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5') IS NOT NULL THEN RAISE EXCEPTION 'line_fault_left_partial_state';END IF;
        PERFORM set_config('vinpoker.template_save_fault','off',true);
        r:=public.chip_ops_save_stack_template_v2(tour,set_id,'FAULT TEST',20000,lines,fault_nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
        IF r->>'outcome' IS DISTINCT FROM 'saved' THEN RAISE EXCEPTION 'same_nonce_retry_after_rollback_failed';END IF;
        saved:=receipt->'result';
      ELSE
        saved:=public.chip_ops_save_stack_template(tour,'20k TEST',20000,lines);
      END IF;
      IF ${templateReplayRepro?'true':'false'} THEN
        r:=public.chip_ops_save_stack_template(tour,'20k TEST',20000,
          jsonb_build_array(jsonb_build_object('denomination_id',denom,'count',200)));
        IF r IS DISTINCT FROM saved THEN RAISE EXCEPTION 'CHIP_TEMPLATE_LOST_RESPONSE_RETRY_CANNOT_RECOVER:%',r;END IF;
      END IF;
      IF ${partialRepro?'true':'false'} THEN
        r:=public.chip_ops_create_chip_set('349ecf35-50ba-4c71-a581-15dc45f1cd01','Legacy partial TEST '||gen_random_uuid());
        unused:=(r->>'chip_set_id')::uuid;
        r:=public.chip_ops_bind_tournament_chip_set(tour,unused);
        IF r->>'error' IS DISTINCT FROM 'BINDING_LOCKED_TEMPLATES_EXIST' THEN RAISE EXCEPTION 'legacy_partial_fixture_invalid:%',r;END IF;
        IF EXISTS(SELECT 1 FROM public.chip_set WHERE id=unused) THEN
          RAISE EXCEPTION 'CHIP_SETUP_LEGACY_ORPHAN_AFTER_BIND_FAILURE';
        END IF;
      END IF;
      PERFORM set_config('request.jwt.claim.sub','${outsider}',true);
      PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${outsider}"}',true);
      IF ${templateV2?'true':'false'} THEN
        BEGIN
          PERFORM public.get_chip_template_save_receipt_v1(tour,set_id,'20k TEST',20000,lines,nonce,'${outsider}');
          RAISE EXCEPTION 'outsider_receipt_read_allowed';
        EXCEPTION WHEN insufficient_privilege THEN NULL;END;
        BEGIN
          PERFORM public.chip_ops_save_stack_template_v2(tour,set_id,'20k TEST',20000,lines,nonce,'a364de8e-06b1-4428-a20d-ac614ec406e5');
          RAISE EXCEPTION 'forged_actor_allowed';
        EXCEPTION WHEN insufficient_privilege THEN NULL;END;
      END IF;
      denied:=jsonb_build_object(
        'create',public.chip_ops_create_chip_set('349ecf35-50ba-4c71-a581-15dc45f1cd01','Outsider TEST'),
        'bind',public.chip_ops_bind_tournament_chip_set(tour,set_id),
        'add',public.chip_ops_add_denomination(set_id,10000,'red',NULL,2),
        'delete',public.chip_ops_delete_denomination(denom),
        'save',public.chip_ops_save_stack_template(tour,'Outsider TEST',20000,jsonb_build_array(jsonb_build_object('denomination_id',denom,'count',200))));
      RETURN jsonb_build_object('create',created,'bind',bound,'unchanged',same,'add',added,'delete',removed,'save',saved,
        'setId',set_id,'deletedId',unused,'denied',denied);
    END $$;
    SET LOCAL ROLE authenticated;
    SELECT pg_temp.chip_setup_receipts();ROLLBACK;`));
  for(const [key,name,args] of [
    ['create','chip_ops_create_chip_set',{}],
    ['bind','chip_ops_bind_tournament_chip_set',{p_chip_set_id:result.setId}],
    ['unchanged','chip_ops_bind_tournament_chip_set',{p_chip_set_id:result.setId}],
    ['add','chip_ops_add_denomination',{}],
    ['delete','chip_ops_delete_denomination',{p_denomination_id:result.deletedId}],
    ['save','chip_ops_save_stack_template',{p_stack_value:20000}],
  ]){
    assert.deepEqual(parseChipSetupReceipt(name,args,result[key]),result[key],name+' native receipt rejected');
    const denied=result.denied[key==='unchanged'?'bind':key];assert.equal(denied.error,'Forbidden');
    assert.equal(parseChipSetupReceipt(name,args,denied),null,'outsider response accepted as commit');
  }
  assert.equal(result.unchanged.action,'unchanged');assert.equal(counts(),before,'rollback fixture changed canonical counts');
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${outsider}');`),'f');
  console.log('CHIP_SETUP_FIVE_NATIVE_CANONICAL_RECEIPTS_OUTSIDER_ROLLBACK_PASS');
  if(templateV2)console.log('CHIP_TEMPLATE_V2_REPLAY_LOOKUP_CANCEL_CONFLICT_OUTSIDER_FAULT_ROLLBACK_PASS');
  if(templateV2)assert.equal(sql('SELECT count(*) FROM private.chip_template_save_receipts_v1;'),receiptCount,'rollback left template receipts');
}
