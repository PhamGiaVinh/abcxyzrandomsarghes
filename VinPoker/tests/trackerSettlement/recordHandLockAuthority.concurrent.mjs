import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_finish94_unified','vinpoker_ops_finish94_ci'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const hand='86000000-0000-4000-8000-000000000001',tracker='81400000-0000-4000-8000-000000000001',owner='81100000-0000-4000-8000-000000000001';
function sql(query){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
const finish=`SELECT public.record_hand('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,now(),
 (SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,'starting_stack',starting_stack,'ending_stack',starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players WHERE hand_id='${hand}'),
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'${tracker}');`;
const takeover=`SELECT public.takeover_hand_lock('${hand}',true,'${owner}');`;
function tx(marker,actor,query,hold=false){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${marker}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(marker,condition){for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail(`finish94 missing overlap: ${marker}`);}
for(const takeoverFirst of [true,false]){
 sql(`UPDATE public.tournament_hands SET status='in_progress',is_voided=false,locked_by_user_id='${tracker}',locked_at=now() WHERE id='${hand}';`);
 let holder,waiter;
 try{
  holder=tx('finish94_holder',takeoverFirst?owner:tracker,takeoverFirst?takeover:finish,true);
  await barrier('finish94_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx('finish94_waiter',takeoverFirst?tracker:owner,takeoverFirst?finish:takeover);
  await barrier('finish94_waiter',"wait_event_type='Lock'");
  holder.end('COMMIT');const a=await holder.result,b=await waiter.result;
  assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
  if(takeoverFirst){assert.equal(JSON.parse(a.out).ok,true);assert.equal(JSON.parse(b.out).error,'lock_not_held');assert.equal(sql(`SELECT status||':'||locked_by_user_id::text FROM public.tournament_hands WHERE id='${hand}';`),`in_progress:${owner}`);}
  else {assert.equal(JSON.parse(a.out).ok,true);assert.equal(JSON.parse(b.out).error,'hand_not_in_progress');assert.equal(sql(`SELECT status||':'||(locked_by_user_id IS NULL)::text FROM public.tournament_hands WHERE id='${hand}';`),'completed:true');}
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
console.log('RECORD_HAND_TAKEOVER_BOTH_ORDER_TRUE_OVERLAP_PASS');
