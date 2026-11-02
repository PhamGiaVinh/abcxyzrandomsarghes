import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.ok(['vinpoker_ops_history99_ci','vinpoker_ops_history99_qualified'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(input){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet;"),'t');
const hand='86000000-0000-4000-8000-000000000001';
function tx(name,query,hold=false){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){for(let i=0;i<150;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail(`missing real overlap ${name}`);}
const parse=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
const state=()=>sql(`SELECT jsonb_build_object('seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e),'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tournament_settlement_outcomes o));`);
const before=state();
for(const correctionFirst of [true,false]){
 const revision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
 const resolve=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
 SELECT public.resolve_tracker_historical_display_intent_v1('${hand}','85000000-0000-4000-8000-000000000001',
 '81100000-0000-4000-8000-000000000001','history99-overlap-${correctionFirst}',${revision},repeat('a',64),repeat('b',64));`;
 const correction=`UPDATE public.tournament_hands SET pot_size=coalesce(pot_size,0)+1 WHERE id='${hand}';`;
 let holder,waiter;
 try{
  holder=tx('history99_holder',correctionFirst?correction:resolve,true);
  await barrier('history99_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx('history99_waiter',correctionFirst?resolve:correction);
  await barrier('history99_waiter',"wait_event_type='Lock'");
  holder.end('COMMIT');const first=await holder.result,last=await waiter.result;
  assert.equal(first.code,0,first.error);assert.equal(last.code,0,last.error);
  assert.equal(parse(correctionFirst?last.out:first.out).status,correctionFirst?'intent_obsolete':'receipt_not_found');
  const resolved=parse(sql(`BEGIN;${resolve}COMMIT;`));assert.equal(resolved.status,'intent_obsolete');
  assert.ok(resolved.current_source_revision>revision);assert.equal(resolved.receipt,null);
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
assert.equal(state(),before,'resolution/correction changed seats, entries or outcome audit');
console.log('HISTORY99_CORRECTION_RESOLUTION_TRUE_BOTH_ORDER_OVERLAP_PASS');
