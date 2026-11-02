import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.VINPOKER_UNDO593,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:25000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 'operations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_correction_operations x),
 'scopes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_correction_uat_scopes x),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
const before=fingerprint();
// Local-only guarded installation, no migration ledger mutation or capability grant.
assert.equal(sql("SELECT to_regclass('private.tracker_undo_intent_cancellations_v1') IS NULL;"),'t');
sql(readFileSync(new URL('../../supabase/migrations/20270128000265_tracker_undo_intent_cancellation_v1.sql',import.meta.url),'utf8'));
function session(name){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',closed=false;
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',()=>closed=true);
 const send=q=>child.stdin.write(q+'\n');
 send(`SET application_name='undo593-${name}';SET statement_timeout='12s';SET idle_in_transaction_session_timeout='25s';`);
 return {send,get out(){return out;},async until(marker){const end=Date.now()+15000;while(!out.includes(marker)){
  if(closed)throw Error(err);if(Date.now()>end)throw Error('missing '+marker+' '+err);await delay(40);
 }},async close(){child.stdin.end('ROLLBACK;\n\\q\n');if(!closed)await new Promise(resolve=>child.once('close',resolve));}};
}
const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const scope="'46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344'";
const freshKey=randomUUID(), recordedKey='bad8e19f-9679-4cd2-97be-674e9a206a79';
const call=(rpc,recorded=false)=>`SELECT public.${rpc}(${scope},'${recorded?'876a9056-b3bf-414c-a1f6-5e344fc003d3':'7080b766-b07b-41c5-b4f5-d3350cc505d5'}','${recorded?'1529555e-5907-4be9-95ab-0cc3edcc2d04':'aa364f28-b2a2-4793-b383-6c9c8322fe01'}',6,'${recorded?recordedKey:freshKey}');`;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';`;
const last=out=>JSON.parse(out.split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1));
async function blocking(){const end=Date.now()+10000;while(Date.now()<end){
 const wait=sql("SELECT b.wait_event_type||':'||b.wait_event FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='undo593-a' WHERE b.application_name='undo593-b' AND b.state='active' AND a.pid=ANY(pg_blocking_pids(b.pid));");
 if(wait==='Lock:advisory')return wait;await delay(60);
}throw Error('no real advisory-lock overlap');}
const a=session('a'),b=session('b'),waits=[];
try{
 for(let n=0;n<2;n++){
  const recorded=n===1;
  a.send(`BEGIN;${auth}${call(recorded?'undo_tracker_last_action_v1':'cancel_tracker_undo_intent_v1',recorded)}SELECT 'A${n}';`);
  await a.until(`A${n}`);
  b.send(`BEGIN;${auth}${call(recorded?'cancel_tracker_undo_intent_v1':'undo_tracker_last_action_v1',recorded)}SELECT 'B${n}';`);
  waits.push(await blocking());
  a.send(`COMMIT;SELECT 'AC${n}';`);await a.until(`AC${n}`);await b.until(`B${n}`);
  const first=last(a.out),second=last(b.out);
  if(recorded){assert.equal(first.ok,true);assert.equal(first.duplicate,true);assert.equal(second.outcome,'recorded');assert.deepEqual(second.receipt,first);}
  else{assert.equal(first.outcome,'cancelled');assert.equal(second.error,'undo_request_cancelled');}
  b.send(`COMMIT;SELECT 'BC${n}';`);await b.until(`BC${n}`);
 }
 assert.equal(sql(`SELECT count(*) FROM private.tracker_undo_intent_cancellations_v1 WHERE actor_user_id='${actor}' AND idempotency_key='${freshKey}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM private.tracker_undo_intent_cancellations_v1 WHERE idempotency_key IN('${recordedKey}','d69b3aed-ab90-42db-93fd-633e7903427e');`),'0');
 assert.equal(fingerprint(),before);
 console.log('UNDO593_CANCEL_FIRST_RECORDED_REPLAY_FIRST_TRUE_OVERLAP_PASS',JSON.stringify({freshKey,waits,businessUnchanged:true,newlySuccessfulUndoOverlap:false}));
}finally{await a.close();await b.close();}
