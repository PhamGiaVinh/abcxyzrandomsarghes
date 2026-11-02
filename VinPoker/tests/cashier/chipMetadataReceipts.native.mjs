import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseChipSetupMetadataReceipt} from '../../src/lib/chipSetupMetadataIntent.ts';

export function runChipMetadataReceipts(sql){
 const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',outsider=randomUUID(),foreignSet=randomUUID(),foreignDenom=randomUUID();
 const requests={bind:randomUUID(),add:randomUUID(),delete:randomUUID()};
 const foreignClub=sql(`SELECT id FROM public.clubs WHERE id<>'${club}' ORDER BY id LIMIT 1;`);assert.match(foreignClub,/^[a-f0-9-]{36}$/);
 const source=readFileSync('supabase/migrations/20270128000177_chip_setup_metadata_receipts_v1.sql','utf8');
 for(const match of source.matchAll(/CREATE FUNCTION (private|public)\.(\w+)\([\s\S]*?AS \$f\$([\s\S]*?)\$f\$/g)){
  const args='uuid,jsonb,uuid,uuid'+(match[2]==='resolve_chip_setup_metadata_v1'?',text':'');
  assert.equal(sql(`SELECT replace(prosrc,chr(13),'') FROM pg_proc WHERE oid='${match[1]}.${match[2]}(${args})'::regprocedure;`).trim(),match[3].replaceAll('\r','').trim());
  const flags=JSON.parse(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
   'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),
   'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid='${match[1]}.${match[2]}(${args})'::regprocedure;`));
  assert.deepEqual(flags,{owner:'postgres',definer:match[1]==='public',config:['search_path=""'],anon:false,auth:match[1]==='public',service:false});
 }
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'tours',(SELECT count(*) FROM public.tournaments),'sets',(SELECT count(*) FROM public.chip_set),
  'denoms',(SELECT count(*) FROM public.chip_set_denomination),'bindings',(SELECT count(*) FROM public.tournament_chip_set),
  'receipts',(SELECT count(*) FROM private.chip_setup_metadata_receipts_v1),
  'chips',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  'bank',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  'payments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=fingerprint();
 const result=JSON.parse(sql(`BEGIN;
  INSERT INTO auth.users(id) VALUES('${outsider}');
  INSERT INTO public.chip_set(id,club_id,name,created_by) VALUES('${foreignSet}','${foreignClub}','Metadata foreign TEST ${foreignSet}','${actor}');
  INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value,color,display_order,created_by) VALUES('${foreignDenom}','${foreignSet}','${foreignClub}',500,'blue',0,'${actor}');
  -- Test-only postgres oracle: authenticated correctly cannot SELECT the foreign row.
  CREATE FUNCTION pg_temp.foreign_denom_unchanged() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
   SELECT EXISTS(SELECT 1 FROM public.chip_set_denomination WHERE id='${foreignDenom}' AND chip_set_id='${foreignSet}' AND club_id='${foreignClub}' AND value=500);
  $$;
  SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';
  CREATE FUNCTION pg_temp.metadata_fault() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF current_setting('vinpoker.metadata_fault',true)='on' THEN RAISE EXCEPTION 'LOCAL_METADATA_DELETE_FAULT';END IF;RETURN OLD;END $$;
  CREATE TRIGGER chip_metadata177_test_fault BEFORE DELETE ON public.chip_set_denomination FOR EACH ROW EXECUTE FUNCTION pg_temp.metadata_fault();
  CREATE FUNCTION pg_temp.run_metadata() RETURNS jsonb LANGUAGE plpgsql AS $$
  DECLARE tour uuid;set_id uuid;denom uuid;k uuid:='${requests.bind}';add_key uuid:='${requests.add}';delete_key uuid:='${requests.delete}';cancel_key uuid:=gen_random_uuid();fault_key uuid:=gen_random_uuid();
   payload jsonb;bind_payload jsonb;add_payload jsonb;delete_payload jsonb;r jsonb;b jsonb;a jsonb;d jsonb;cancelled jsonb;
  BEGIN
   r:=public.create_tournament_with_levels_v1('${club}',jsonb_build_object('name','Metadata receipts rollback local TEST','start_time',now()+interval '1 hour',
    'buy_in',100000,'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
    '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');
   IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'metadata_fixture_create_failed:%',r;END IF;tour:=(r->>'tournament_id')::uuid;
   r:=public.chip_ops_create_chip_set('${club}','Metadata receipts TEST '||gen_random_uuid());set_id:=(r->>'chip_set_id')::uuid;
   bind_payload:=jsonb_build_object('operation','bind','chip_set_id',set_id,'expected_chip_set_id',NULL);
   IF public.get_chip_setup_metadata_receipt_v1(tour,bind_payload,k,'${actor}') IS NOT NULL THEN RAISE EXCEPTION 'new_receipt_not_null';END IF;
   b:=public.chip_ops_apply_setup_metadata_v1(tour,bind_payload,k,'${actor}');
   IF b->>'outcome' IS DISTINCT FROM 'applied' OR b->'result'->>'action' IS DISTINCT FROM 'bound' OR b->'payload' IS DISTINCT FROM bind_payload THEN RAISE EXCEPTION 'bad_bind:%',b;END IF;
   IF public.chip_ops_apply_setup_metadata_v1(tour,bind_payload,k,'${actor}') IS DISTINCT FROM b OR public.get_chip_setup_metadata_receipt_v1(tour,bind_payload,k,'${actor}') IS DISTINCT FROM b
    OR public.cancel_chip_setup_metadata_v1(tour,bind_payload,k,'${actor}') IS DISTINCT FROM b THEN RAISE EXCEPTION 'bind_replay_changed';END IF;
   r:=public.chip_ops_apply_setup_metadata_v1(tour,bind_payload,gen_random_uuid(),'${actor}');
   IF r->>'error' IS DISTINCT FROM 'CHIP_SET_BINDING_CHANGED_RELOAD' THEN RAISE EXCEPTION 'stale_bind_not_rejected';END IF;
   payload:=jsonb_build_object('operation','bind','chip_set_id','${foreignSet}','expected_chip_set_id',set_id);
   r:=public.chip_ops_apply_setup_metadata_v1(tour,payload,gen_random_uuid(),'${actor}');
   IF r->>'error' IS DISTINCT FROM 'CHIP_SET_CLUB_MISMATCH' THEN RAISE EXCEPTION 'crossclub_set_not_rejected';END IF;
   BEGIN PERFORM public.chip_ops_apply_setup_metadata_v1(tour,payload,k,'${actor}');RAISE EXCEPTION 'payload_conflict_missing';
    EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'chip_metadata_request_payload_conflict' THEN RAISE;END IF;END;
   add_payload:=jsonb_build_object('operation','add','chip_set_id',set_id,'value',100,'color','red','label',NULL,'display_order',0);
   a:=public.chip_ops_apply_setup_metadata_v1(tour,add_payload,add_key,'${actor}');denom:=(a->'result'->>'denomination_id')::uuid;
   IF a->>'outcome' IS DISTINCT FROM 'applied' OR denom IS NULL THEN RAISE EXCEPTION 'bad_add:%',a;END IF;
   IF public.chip_ops_apply_setup_metadata_v1(tour,add_payload,add_key,'${actor}') IS DISTINCT FROM a OR public.get_chip_setup_metadata_receipt_v1(tour,add_payload,add_key,'${actor}') IS DISTINCT FROM a THEN RAISE EXCEPTION 'add_replay_changed';END IF;
   r:=public.chip_ops_apply_setup_metadata_v1(tour,add_payload,gen_random_uuid(),'${actor}');IF r->>'error' IS DISTINCT FROM 'VALUE_EXISTS' THEN RAISE EXCEPTION 'new_nonce_duplicate_value_rule_changed';END IF;
   payload:=jsonb_build_object('operation','delete','chip_set_id',set_id,'denomination_id','${foreignDenom}');
   r:=public.chip_ops_apply_setup_metadata_v1(tour,payload,gen_random_uuid(),'${actor}');
   IF r->>'error' IS DISTINCT FROM 'DENOM_NOT_IN_SET' OR NOT pg_temp.foreign_denom_unchanged() THEN RAISE EXCEPTION 'crossclub_denom_not_rejected:%',r;END IF;
   delete_payload:=jsonb_build_object('operation','delete','chip_set_id',set_id,'denomination_id',denom);
   d:=public.chip_ops_apply_setup_metadata_v1(tour,delete_payload,delete_key,'${actor}');
   IF d->>'outcome' IS DISTINCT FROM 'applied' OR d->'result'->>'denomination_id' IS DISTINCT FROM denom::text OR EXISTS(SELECT 1 FROM public.chip_set_denomination WHERE id=denom) THEN RAISE EXCEPTION 'bad_delete:%',d;END IF;
   IF public.chip_ops_apply_setup_metadata_v1(tour,delete_payload,delete_key,'${actor}') IS DISTINCT FROM d OR public.get_chip_setup_metadata_receipt_v1(tour,delete_payload,delete_key,'${actor}') IS DISTINCT FROM d THEN RAISE EXCEPTION 'delete_replay_changed';END IF;
   IF public.chip_ops_apply_setup_metadata_v1(tour,add_payload,add_key,'${actor}') IS DISTINCT FROM a OR EXISTS(SELECT 1 FROM public.chip_set_denomination WHERE id=denom) THEN RAISE EXCEPTION 'historical_add_replay_recreated_deleted_row';END IF;
   r:=public.chip_ops_apply_setup_metadata_v1(tour,delete_payload,gen_random_uuid(),'${actor}');IF r->>'error' IS DISTINCT FROM 'DENOM_NOT_FOUND' THEN RAISE EXCEPTION 'new_nonce_missing_denom_rule_changed';END IF;
   cancelled:=public.cancel_chip_setup_metadata_v1(tour,add_payload,cancel_key,'${actor}');
   IF cancelled->>'outcome' IS DISTINCT FROM 'cancelled' OR public.chip_ops_apply_setup_metadata_v1(tour,add_payload,cancel_key,'${actor}') IS DISTINCT FROM cancelled THEN RAISE EXCEPTION 'cancel_did_not_fence_add';END IF;
   BEGIN PERFORM public.chip_ops_apply_setup_metadata_v1(tour,add_payload||'{"value":0.5}',gen_random_uuid(),'${actor}');RAISE EXCEPTION 'fractional_value_allowed';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
   BEGIN PERFORM public.chip_ops_apply_setup_metadata_v1(tour,bind_payload||'{"unexpected":true}',gen_random_uuid(),'${actor}');RAISE EXCEPTION 'unknown_payload_key_allowed';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
   -- Exact fault rolls back the delete and its receipt, never a guessed success.
   r:=public.chip_ops_apply_setup_metadata_v1(tour,add_payload,gen_random_uuid(),'${actor}');denom:=(r->'result'->>'denomination_id')::uuid;
   payload:=jsonb_build_object('operation','delete','chip_set_id',set_id,'denomination_id',denom);
   PERFORM set_config('vinpoker.metadata_fault','on',true);
   BEGIN PERFORM public.chip_ops_apply_setup_metadata_v1(tour,payload,fault_key,'${actor}');RAISE EXCEPTION 'delete_fault_missing';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LOCAL_METADATA_DELETE_FAULT' THEN RAISE;END IF;END;
   IF NOT EXISTS(SELECT 1 FROM public.chip_set_denomination WHERE id=denom) OR public.get_chip_setup_metadata_receipt_v1(tour,payload,fault_key,'${actor}') IS NOT NULL THEN RAISE EXCEPTION 'fault_left_partial_delete';END IF;
   PERFORM set_config('vinpoker.metadata_fault','off',true);
   r:=public.chip_ops_apply_setup_metadata_v1(tour,payload,fault_key,'${actor}');IF r->>'outcome' IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'same_nonce_after_fault_failed';END IF;
   PERFORM set_config('request.jwt.claim.sub','${outsider}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${outsider}"}',true);
   BEGIN PERFORM public.get_chip_setup_metadata_receipt_v1(tour,add_payload,add_key,'${outsider}');RAISE EXCEPTION 'outsider_read_allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   BEGIN PERFORM public.chip_ops_apply_setup_metadata_v1(tour,add_payload,add_key,'${actor}');RAISE EXCEPTION 'forged_actor_allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   BEGIN PERFORM 1 FROM private.chip_setup_metadata_receipts_v1;RAISE EXCEPTION 'private_receipts_readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   RETURN jsonb_build_object('tour',tour,'set',set_id,'deleted',a->'result'->>'denomination_id','bind',b,'add',a,'delete',d,'cancel',cancelled);
  END $$;
  SET LOCAL ROLE authenticated;SELECT pg_temp.run_metadata();ROLLBACK;`));
 const payloads={bind:{operation:'bind',chip_set_id:result.set,expected_chip_set_id:null},
  add:{operation:'add',chip_set_id:result.set,value:100,color:'red',label:null,display_order:0},
  delete:{operation:'delete',chip_set_id:result.set,denomination_id:result.deleted}};
 for(const operation of ['bind','add','delete']){
  assert.equal(result[operation].outcome,'applied');assert.equal(result[operation].payload.operation,operation);assert.equal(result[operation].actor_id,actor);assert.equal(result[operation].club_id,club);
  assert.deepEqual(parseChipSetupMetadataReceipt(result[operation],{version:1,actorId:actor,clubId:club,tournamentId:result.tour,requestId:requests[operation],payload:payloads[operation]}),result[operation]);
 }
 assert.equal(result.cancel.outcome,'cancelled');assert.equal(fingerprint(),before,'metadata test changed state after rollback');
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${outsider}') OR EXISTS(SELECT 1 FROM public.chip_set WHERE id='${foreignSet}');`),'f');
 assert.equal(sql("SELECT relrowsecurity AND NOT has_table_privilege('authenticated',oid,'SELECT') AND NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('service_role',oid,'SELECT') FROM pg_class WHERE oid='private.chip_setup_metadata_receipts_v1'::regclass;"),'t');
 console.log('CHIP_METADATA177_BIND_ADD_DELETE_REPLAY_CANCEL_CONFLICT_TENANT_FAULT_ROLLBACK_PASS');
}
