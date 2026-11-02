import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clearChipSetupMetadataIntent,parseChipSetupMetadataReceipt,persistChipSetupMetadataIntent,readChipSetupMetadataIntent} from '../../src/lib/chipSetupMetadataIntent.ts';

export function prepareChipMetadataBrowser(sql){
 const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',tag=randomUUID();
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const result=JSON.parse(sql(`BEGIN;${auth}SELECT public.create_tournament_with_levels_v1('${club}',
 jsonb_build_object('name','Metadata overlap local TEST ${tag}','start_time',now()+interval '1 hour','buy_in',100000,'rake_amount',0,'service_fee_amount',0,
 'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
 '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');COMMIT;`));
 assert.equal(result.ok,true);
 const set=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_create_chip_set('${club}','Metadata overlap TEST ${tag} browser');COMMIT;`));
 assert.equal(set.status,'ok');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_chip_set WHERE tournament_id='${result.tournament_id}';`),'0');
 console.log('CHIP_METADATA_BROWSER_ZERO_MONEY_UNBOUND_CANARY',JSON.stringify({tour:result.tournament_id,set:set.chip_set_id,club,actor,tag}));
}

export async function runChipMetadataOverlap({sql,session,until}){
 const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',tag=randomUUID();
 const auth=`SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const financial=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=financial(),tourReply=JSON.parse(sql(`BEGIN;${auth}SELECT public.create_tournament_with_levels_v1('${club}',
  jsonb_build_object('name','Metadata overlap local TEST ${tag}','start_time',now()+interval '1 hour','buy_in',100000,'rake_amount',0,'service_fee_amount',0,
    'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
  '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');COMMIT;`));
 assert.equal(tourReply.ok,true);const tour=tourReply.tournament_id,sets=[];
 for(const suffix of ['A','B']){
  const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_create_chip_set('${club}','Metadata overlap TEST ${tag} ${suffix}');COMMIT;`));assert.equal(r.status,'ok');sets.push(r.chip_set_id);
 }
 let rows=new Map();const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},scope={actorId:actor,clubId:club,tournamentId:tour};
 const result=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));let cases=0;
 for(const operation of ['bind','add','delete']){
  let index=0;
  for(const order of ['apply-apply','apply-cancel','cancel-apply','payload-conflict','different-keys']){
   const current=sql(`SELECT chip_set_id FROM public.tournament_chip_set WHERE tournament_id='${tour}';`)||null;
   let payload;
   if(operation==='bind')payload={operation,chip_set_id:current===sets[0]?sets[1]:sets[0],expected_chip_set_id:current};
   else if(operation==='add')payload={operation,chip_set_id:current,value:100+index,color:'red',label:null,display_order:index};
   else {
    const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_add_denomination('${current}',${1000+index},'red',NULL,${index});COMMIT;`));assert.equal(r.status,'ok');
    payload={operation,chip_set_id:current,denomination_id:r.denomination_id};
   }
   index++;
   const intent=persistChipSetupMetadataIntent(storage,scope,payload),key=intent.requestId,otherKey=order==='different-keys'?randomUUID():key;
   const changed=operation==='bind'?{...payload,expected_chip_set_id:randomUUID()}:operation==='add'?{...payload,value:payload.value+5000}:{...payload,denomination_id:randomUUID()};
   const args=(p=payload,nonce=key)=>`'${tour}','${JSON.stringify(p).replaceAll("'","''")}'::jsonb,'${nonce}','${actor}'`;
   const call=(cancel,p=payload,nonce=key)=>`public.${cancel?'cancel_chip_setup_metadata_v1':'chip_ops_apply_setup_metadata_v1'}(${args(p,nonce)})`;
   const app='chip177_'+key.replaceAll('-','').slice(0,12);let holder,waiter;
   try{
    holder=session(app+'_holder');holder.child.stdin.write(`BEGIN;${auth}SELECT 'RESULT:'||(${call(order==='cancel-apply')})::text;\n\\echo METADATA_HELD\n`);
    await until(()=>holder.output().includes('METADATA_HELD'));const initial=result(holder.output());
    assert.equal(initial.outcome,order==='cancel-apply'?'cancelled':'applied');
    assert.equal(sql(`BEGIN;${auth}SELECT coalesce(public.get_chip_setup_metadata_receipt_v1(${args()}),'null'::jsonb);ROLLBACK;`),'null');
    waiter=session(app+'_waiter');waiter.child.stdin.end(`BEGIN;${auth}SELECT 'RESULT:'||(${call(order==='apply-cancel',order==='payload-conflict'?changed:payload,otherKey)})::text;COMMIT;\n`);
    await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}_waiter' AND wait_event_type='Lock');`)==='t');
    holder.child.stdin.end('COMMIT;\n');await holder.closed;
    if(order==='payload-conflict')await assert.rejects(waiter.closed,/chip_metadata_request_payload_conflict/);
    else {
     const repeated=result(await waiter.closed);
     if(order==='different-keys'){
      assert.equal(repeated.outcome,'rejected');assert.equal(repeated.error,operation==='bind'?'CHIP_SET_BINDING_CHANGED_RELOAD':operation==='add'?'VALUE_EXISTS':'DENOM_NOT_FOUND');
     }else assert.deepEqual(repeated,initial);
    }
    if(operation==='bind')assert.equal(sql(`SELECT chip_set_id FROM public.tournament_chip_set WHERE tournament_id='${tour}';`)||null,order==='cancel-apply'?current:payload.chip_set_id);
    else if(operation==='add')assert.equal(Number(sql(`SELECT count(*) FROM public.chip_set_denomination WHERE chip_set_id='${current}' AND value=${payload.value};`)),order==='cancel-apply'?0:1);
    else assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.chip_set_denomination WHERE id='${payload.denomination_id}');`),order==='cancel-apply'?'t':'f');
    assert.equal(Number(sql(`SELECT count(*) FROM private.chip_setup_metadata_receipts_v1 WHERE tournament_id='${tour}' AND request_id IN('${key}','${otherKey}');`)),order==='different-keys'?2:1);
    rows=new Map(JSON.parse(JSON.stringify([...rows])));const recovered=readChipSetupMetadataIntent(storage,scope);assert.deepEqual(recovered,intent);
    const receipt=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_chip_setup_metadata_receipt_v1(${args(recovered.payload,recovered.requestId)});COMMIT;`));
    assert.deepEqual(parseChipSetupMetadataReceipt(receipt,recovered),initial);clearChipSetupMetadataIntent(storage,recovered,receipt);assert.equal(readChipSetupMetadataIntent(storage,scope),null);
    cases++;console.log('CHIP_METADATA177_REAL_LOCK_PASS',JSON.stringify({operation,order,tour,key,otherKey,outcome:initial.outcome,retained:'TEST metadata and immutable receipts; no issue/payment'}));
   }finally{
    for(const handle of [holder,waiter])if(handle){if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');await handle.closed.catch(()=>{});}
   }
  }
 }
 assert.equal(cases,15);assert.equal(financial(),before,'metadata overlap changed chip/bank/payment ledgers');
 console.log('CHIP_METADATA177_FIFTEEN_TRUE_OVERLAPS_COMMIT_JOURNAL_FINANCIAL_UNCHANGED_PASS');
}
