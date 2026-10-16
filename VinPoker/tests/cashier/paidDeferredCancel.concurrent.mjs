import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';

assert.equal(process.env.VINPOKER_NATIVE_DEFERRED_CANCEL,'1');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000}).trim();
const parse=out=>JSON.parse(out.split('\n').findLast(line=>line.startsWith('{')));
function tx(name,query,hold){
 const child=spawn(binary,[...prefix,...flags]);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end(command+';\n');};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='20s';${query}SET CONSTRAINTS ALL IMMEDIATE;\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){
 for(let n=0;n<100;n++){
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;
  await new Promise(done=>setTimeout(done,25));
 }
 assert.fail('actual deferred Finish/cancel lock barrier absent: '+name);
}
for(const first of ['cancel','finish']){
 const f=createPaidJourneyFixture(sql);
 let journey=readFileSync(new URL('./paidActiveHand.pg17.sql',import.meta.url),'utf8');
 const marker=' finish_receipt:=public.record_tracker_manual_hand_v1(finish_intent);';assert.equal(journey.split(marker).length,2);
 // Stop only after canonical start, paid waiting registration, exact queued
 // move and pending mode exist. Keep the real writer's exact generated intent.
 journey=journey.replace(marker," PERFORM set_config('role','none',true);INSERT INTO pg_temp.native_deferred_intent VALUES(finish_intent);RETURN;"+marker);
 assert.match(journey,/ROLLBACK;\s*SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';/);
 journey=journey.replace(/ROLLBACK;\s*SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';/,'COMMIT;SELECT intent FROM pg_temp.native_deferred_intent;');
 const intent=parse(sql(String.raw`\set PAID_REGISTRATION ${f.registration}
\set PAID_MOVE_CASE true
\set PAID_CORRECTION_CASE false
CREATE TEMP TABLE native_deferred_intent(intent jsonb);
`+journey));assert.equal(intent.actor_id,f.actor);assert.equal(intent.tournament_id,f.tour);
 const q=parse(sql(`SELECT to_jsonb(q) FROM public.floor_pending_tracker_moves q WHERE tournament_id='${f.tour}' AND status='pending';`));
 assert.equal(q.destination_table_session_id,intent.table_session_id);
 assert.equal(sql(`SELECT count(*) FROM public.floor_pending_tracker_moves WHERE tournament_id='${f.tour}';`),'1');
 assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${intent.hand_id}';`),'in_progress');
 const auth=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
 const invoke=body=>parse(sql(`BEGIN;${auth(f.actor)}${body}COMMIT;`));
 const cancel=`SELECT public.floor_cancel_pending_tracker_move_v1('${q.id}');`;
 const finish=`SELECT public.record_tracker_manual_hand_v1('${JSON.stringify(intent).replaceAll("'","''")}'::jsonb);`;
 const before=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_hands r WHERE tournament_id='${f.tour}'),
 'players',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.hand_players r WHERE hand_id='${intent.hand_id}'),
 'actions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.hand_actions r WHERE hand_id='${intent.hand_id}'),
 'sessions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.table_sessions r WHERE tournament_id='${f.tour}'),
 'queue',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.floor_pending_tracker_moves r WHERE tournament_id='${f.tour}'))::text);`);
 const pre=before(),outsider=crypto.randomUUID();sql(`INSERT INTO auth.users(id) VALUES('${outsider}');`);
 const denied=parse(sql(`BEGIN;${auth(outsider)}${cancel}COMMIT;`));assert.equal(denied.error,'actor_not_allowed');assert.equal(before(),pre);
 const money=()=>sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}';`),moneyBefore=money();
 const entryIds=sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`);
 const suffix=crypto.randomUUID().slice(0,8),holderName='paid_deferred_h_'+suffix,waiterName='paid_deferred_w_'+suffix;
 let holder,waiter;
 try{
  holder=tx(holderName,auth(f.actor)+(first==='cancel'?cancel:finish),true);
  await barrier(holderName,"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx(waiterName,auth(f.actor)+(first==='cancel'?finish:cancel),false);
  if(first==='cancel'){
   // Canonical Finish deliberately uses NOWAIT, not blocking row locks.
   const busy=await waiter.result;assert.equal(busy.code,0,busy.error);assert.deepEqual(parse(busy.out),{ok:false,error:'manual_finish_busy'});
   await barrier(holderName,"wait_event='ClientRead' AND xact_start IS NOT NULL");
   assert.equal(before(),pre,'busy Finish cannot commit a hand, move, entry, seat or cash change');
   assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${intent.hand_id}';`),'in_progress');
   assert.equal(sql(`SELECT count(*) FROM floor_private.floor_table_v3_existing_receipt('${f.actor}','record_tracker_manual_hand_v1','${intent.request_id}');`),'0');
  }else await barrier(waiterName,"wait_event_type='Lock'");
  holder.end('COMMIT');
  const h=await holder.result,w=await waiter.result;assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
  const results={[first]:parse(h.out),[first==='cancel'?'finish':'cancel']:parse(w.out)};
  // Explicit caller retry only after the cancellation has committed; same key
  // and payload, no product automatic retry and no key regeneration.
  if(first==='cancel')results.finish=invoke(finish);
  assert.equal(results.finish.ok,true);assert.equal(results.cancel.ok,true);
  assert.equal(results.cancel.status,first==='cancel'?'cancelled':'applied');
  if(first==='finish')assert.equal(results.cancel.already_resolved,true);
  const expected=first==='cancel'?'cancelled':'applied';
  assert.equal(sql(`SELECT status FROM public.floor_pending_tracker_moves WHERE id='${q.id}';`),expected);
  assert.equal(sql(`SELECT table_session_id FROM public.tournament_seats WHERE entry_id='${q.entry_id}' AND is_active;`),first==='cancel'?q.source_table_session_id:q.destination_table_session_id);
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${q.entry_id}' AND is_active AND chip_count=20000;`),'1');
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`),'3|60000');
  assert.equal(sql(`SELECT count(*) FROM public.hand_players WHERE hand_id='${intent.hand_id}';`),'2','queued entrant never joins the hand being finished');
  assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${intent.hand_id}';`),'completed');
  assert.equal(sql(`SELECT control_mode||'|'||control_epoch FROM public.table_sessions WHERE id='${intent.table_session_id}';`),'manual|'+(intent.control_epoch+1));
  assert.equal(sql(`SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${intent.table_session_id}' AND status='pending';`),'0');
  assert.equal(money(),moneyBefore);assert.equal(sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),entryIds);
  const settled=before();assert.deepEqual(invoke(finish),results.finish);assert.equal(invoke(cancel).status,expected);assert.equal(before(),settled,'both terminal retries have no second effect');
  if(first==='cancel'){
   const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${q.source_table_session_id}';`);
   assert.equal(invoke(`SELECT public.close_tournament_table_v4('${q.source_tournament_table_id}',${revision},'${crypto.randomUUID()}');`).error,'table_not_empty');assert.equal(before(),settled);
  }
  console.log('PAID_CANONICAL_FINISH_CANCEL_TRUE_LOCK_OVERLAP_'+first.toUpperCase()+'_FIRST_PASS',JSON.stringify({tour:f.tour,hand:intent.hand_id,move:q.id}));
 }catch(error){
  holder?.end('ROLLBACK');waiter?.end('ROLLBACK');
  const [h,w]=await Promise.all([holder?.result,waiter?.result]);
  throw new Error(error.message+' '+JSON.stringify({holder:h,waiter:w}));
 }finally{
  holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);
 }
}
