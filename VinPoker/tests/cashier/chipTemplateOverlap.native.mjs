import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clearChipTemplateSaveIntent,parseChipTemplateSaveReceipt,persistChipTemplateSaveIntent,readChipTemplateSaveIntent,chipTemplateSaveArgs} from '../../src/lib/chipTemplateSaveIntent.ts';

// Canonical TEST metadata only; retained receipts are never deleted to hide a race.
export async function runChipTemplateOverlap({sql,session,until}){
 const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',tag=randomUUID();
 const auth=`SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const financial=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=financial();
 const tourReply=JSON.parse(sql(`BEGIN;${auth}SELECT public.create_tournament_with_levels_v1('${club}',
  jsonb_build_object('name','Template overlap local TEST ${tag}','start_time',now()+interval '1 hour','buy_in',100000,
   'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
  '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),'${actor}');COMMIT;`));
 assert.equal(tourReply.ok,true);const tour=tourReply.tournament_id;
 const bound=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_create_and_bind_set_v1('${tour}','Template overlap TEST ${tag}',gen_random_uuid(),'${actor}');COMMIT;`));
 assert.equal(bound.outcome,'created_bound');const set=bound.chip_set_id;
 const added=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_add_denomination('${set}',100,'red',NULL,0);COMMIT;`));
 assert.equal(added.status,'ok');const lines=JSON.stringify([{denomination_id:added.denomination_id,count:200}]);
 const result=out=>JSON.parse(out.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
 let rows=new Map();
 const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const scope={actorId:actor,clubId:club,tournamentId:tour};
 for(const order of ['save-save','save-cancel','cancel-save','payload-conflict','different-keys']){
  const name=`TEST ${order} ${tag}`;
  const intent=persistChipTemplateSaveIntent(storage,scope,{chipSetId:set,name,stackValue:20000,lines:JSON.parse(lines)});
  const key=intent.requestId,otherKey=order==='different-keys'?randomUUID():key;
  assert.deepEqual(chipTemplateSaveArgs(intent),{p_tournament_id:tour,p_chip_set_id:set,p_name:name,p_stack_value:20000,p_lines:JSON.parse(lines),p_request_id:key,p_expected_actor:actor});
  const args=(nonce=key,label=name)=>`'${tour}','${set}','${label}',20000,'${lines}'::jsonb,'${nonce}','${actor}'`;
  const call=(cancel,nonce=key,label=name)=>`public.${cancel?'cancel_chip_template_save_v1':'chip_ops_save_stack_template_v2'}(${args(nonce,label)})`;
  const application=`chip176_${key.replaceAll('-','').slice(0,12)}`;
  let holder,waiter;
  try{
   holder=session(application+'_holder');
   holder.child.stdin.write(`BEGIN;${auth}SELECT 'RESULT:'||(${call(order==='cancel-save')})::text;\n\\echo TEMPLATE_HELD\n`);
   await until(()=>holder.output().includes('TEMPLATE_HELD'));const initial=result(holder.output());
   assert.equal(sql(`BEGIN;${auth}SELECT coalesce(public.get_chip_template_save_receipt_v1(${args()}),'null'::jsonb);ROLLBACK;`),'null',
    'uncommitted receipt lookup must remain unknown, not a cancel signal');
   waiter=session(application+'_waiter');
   waiter.child.stdin.end(`BEGIN;${auth}SELECT 'RESULT:'||(${call(order==='save-cancel',otherKey,order==='payload-conflict'?'CHANGED '+name:name)})::text;COMMIT;\n`);
   await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${application}_waiter' AND wait_event_type='Lock');`)==='t');
   holder.child.stdin.end('COMMIT;\n');await holder.closed;
   if(order==='payload-conflict')await assert.rejects(waiter.closed,/chip_template_request_payload_conflict/);
   else {
    const repeated=result(await waiter.closed);
    if(order==='different-keys'){assert.equal(repeated.outcome,'rejected');assert.equal(repeated.error,'NAME_EXISTS');}
    else assert.deepEqual(repeated,initial);
   }
   assert.equal(Number(sql(`SELECT count(*) FROM public.stack_template WHERE tournament_id='${tour}' AND name='${name}';`)),order==='cancel-save'?0:1);
   assert.equal(Number(sql(`SELECT count(*) FROM private.chip_template_save_receipts_v1 WHERE tournament_id='${tour}' AND request_id IN('${key}','${otherKey}');`)),order==='different-keys'?2:1);
   // Writer COMMIT finished; a new psql process recovers after serialized client journal reload.
   rows=new Map(JSON.parse(JSON.stringify([...rows])));
   const recoveredIntent=readChipTemplateSaveIntent(storage,scope);assert.deepEqual(recoveredIntent,intent);
   const recoveredReceipt=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_chip_template_save_receipt_v1(${args(recoveredIntent.requestId,recoveredIntent.name)});COMMIT;`));
   assert.deepEqual(parseChipTemplateSaveReceipt(recoveredReceipt,recoveredIntent),initial);
   clearChipTemplateSaveIntent(storage,recoveredIntent,recoveredReceipt);assert.equal(readChipTemplateSaveIntent(storage,scope),null);
   console.log('CHIP_TEMPLATE176_REAL_LOCK_'+order.toUpperCase().replaceAll('-','_')+'_PASS',JSON.stringify({tour,set,key,otherKey,outcome:initial.outcome,retained:'TEST metadata and immutable receipts, no issue/payment'}));
  }finally{
   for(const handle of [holder,waiter])if(handle){
    if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
    await handle.closed.catch(()=>{});
   }
  }
 }
 assert.equal(financial(),before,'template overlap changed chip/bank/payment ledgers');
 console.log('CHIP_TEMPLATE176_FIVE_TRUE_OVERLAPS_COMMITTED_JOURNAL_RECOVERY_FINANCIAL_UNCHANGED_PASS');
}
