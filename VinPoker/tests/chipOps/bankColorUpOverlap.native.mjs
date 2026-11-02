import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';

export async function runBankColorUpOverlap({sql,session,until}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 for(const order of ['color_first','bank_first']){
  const f=createPaidJourneyFixture(sql),set=randomUUID(),low=randomUUID(),high=randomUUID(),template=randomUUID();
  const colorKey=randomUUID(),bankKey=randomUUID();let a,b;
  const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
  const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
  const business=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${f.tour}'),
   'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${f.tour}'),
   'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${f.tour}'))::text);`);
  const before=business();
  assert.equal(sql(`SELECT count(*) FROM public.club_settings WHERE club_id='${f.club}';`),'0');
  sql(`BEGIN;
   INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${f.club}',false);
   INSERT INTO public.chip_set(id,club_id,name) VALUES('${set}','${f.club}','Bank/color overlap local TEST');
   INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('${low}','${set}','${f.club}',100),('${high}','${set}','${f.club}',1000);
   INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('${f.tour}','${set}','${f.club}');
   INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES('${template}','${f.tour}','${f.club}','${set}','Overlap TEST stack',20000);
   INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES('${template}','${low}',200);
   INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${f.club}','${low}',1000),('${f.club}','${high}',100);
   COMMIT;`);
  try{
   assert.equal(call(`SELECT public.chip_ops_set_bank_coupling('${f.club}',true);`).status,'ok');
   assert.equal(call(`SELECT public.chip_ops_set_issuance_v2('${template}',1,0,'${randomUUID()}','${f.actor}');`).status,'ok');
   const version=Number(sql(`SELECT version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${low}';`));
   assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${low}';`),'800');
   const color=`SELECT public.chip_ops_color_up('${f.tour}','${low}','${high}',20,1,'${colorKey}');`;
   const bank=`SELECT public.chip_ops_bank_adjust('${f.club}','${low}','xuat',100,'${f.tour}',${version},'${bankKey}');`;
   const tag='bankcolor_'+randomUUID().replaceAll('-','');
   a=session(tag+'_a');a.child.stdin.write(`BEGIN;${auth}${order==='color_first'?color:bank}SELECT 'BANK_COLOR_FIRST_STAGED';\n`);
   await until(()=>a.output().includes('BANK_COLOR_FIRST_STAGED'));
   b=session(tag+'_b');b.child.stdin.end(`BEGIN;${auth}${order==='color_first'?bank:color}COMMIT;\n`);
   await until(()=>sql(`SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${tag}_a'
    WHERE b.application_name='${tag}_b' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid));`)==='1');
   a.child.stdin.end('COMMIT;\n');
   const outputs=await Promise.all([a.closed,b.closed]);
   const results=outputs.map(out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{'))));
   assert.equal(results[0].status,'ok',JSON.stringify(results));
   if(order==='color_first')assert.equal(results[1].error,'race_lost',JSON.stringify(results));
   else assert.equal(results[1].status,'ok',JSON.stringify(results));
   assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${low}';`),order==='color_first'?'1000':'900');
   assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${high}';`),'80');
   assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}' AND idempotency_key='${bankKey}';`),order==='color_first'?'0':'1');
   const counts=call(`SELECT jsonb_object_agg(denomination_id,current_count) FROM public.chip_ops_current_denom_counts('${f.tour}');`);
   assert.equal(counts[low],0);assert.equal(counts[high],20);
   if(order==='bank_first'){
    const snapshot=sql(`SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.chip_bank_ledger x WHERE club_id='${f.club}';`);
    assert.deepEqual(call(bank),{...results[0],idempotent:true});
    assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.chip_bank_ledger x WHERE club_id='${f.club}';`),snapshot);
   }
   console.log('NATIVE_BANK_COLOR_TRUE_LOCK_OVERLAP_'+order.toUpperCase()+'_PASS',JSON.stringify({tour:f.tour,club:f.club,colorKey,bankKey}));
  }finally{
   for(const pending of [a,b])if(pending&&!pending.child.stdin.writableEnded)pending.child.stdin.end('ROLLBACK;\n');
   await Promise.allSettled([a?.closed,b?.closed].filter(Boolean));
   assert.equal(call(`SELECT public.chip_ops_set_bank_coupling('${f.club}',false);`).status,'ok');
   assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
   assert.equal(business(),before,'chip writer overlap changed paid cash/entry/Floor seat');
  }
 }
}
