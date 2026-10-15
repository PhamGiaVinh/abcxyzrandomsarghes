import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_finish95_qualified','vinpoker_ops_finish95_ci'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const hand='86000000-0000-4000-8000-000000000001',session='83500000-0000-4000-8000-000000000001',actor='81400000-0000-4000-8000-000000000001';
function sql(query){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
const auth=`SET request.jwt.claim.sub='${actor}';SET request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET ROLE authenticated;`;
function intent(){return JSON.parse(sql(`SELECT jsonb_build_object('actor_id','${actor}','request_id',gen_random_uuid(),'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,'hand_id',h.id,'table_session_id',h.table_session_id,'control_epoch',s.control_epoch,'source_revision',h.source_revision,'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object('player_id',p.player_id,'entry_number',p.entry_number,'seat_number',p.seat_number,'starting_stack',p.starting_stack,'ending_stack',p.starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players p WHERE p.hand_id=h.id),'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) FROM public.tournament_hands h JOIN public.table_sessions s ON s.id=h.table_session_id WHERE h.id='${hand}';`));}
const arg=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const write=i=>`SELECT public.record_tracker_manual_hand_v1(${arg(i)});`;
const read=i=>JSON.parse(sql(auth+`SELECT public.get_tracker_manual_finish_receipt_v1(${arg(i)});`));
function reset(){sql(`UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='${session}';UPDATE public.tournament_hands SET status='in_progress',is_voided=false,locked_by_user_id='${actor}',locked_at=now() WHERE id='${hand}';`);}
function tx(marker,query,useAuth=true,hold=false){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${marker}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';${useAuth?auth:''}${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(marker,condition){for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail(`finish95 missing overlap ${marker}`);}
for(const kind of ['duplicate','epoch-first','finish-first']){
 reset();const i=intent();let holder,waiter;
 const update=`UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='${session}';`;
 try{
  holder=tx('finish95_holder',kind==='epoch-first'?update:write(i),kind!=='epoch-first',true);
  await barrier('finish95_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  if(kind==='finish-first'){
   waiter=tx('finish95_waiter',update,false);
   await barrier('finish95_waiter',"wait_event_type='Lock'");
  }else{
   // These writes must return busy, not block while holding a reverse lifecycle lock.
   waiter=tx('finish95_waiter',write(i));const busy=await waiter.result;
   assert.equal(busy.code,0,busy.error);assert.equal(JSON.parse(busy.out).error,'manual_finish_busy');
   assert.equal(read(i).error,'receipt_not_found');
  }
  holder.end('COMMIT');const first=await holder.result,last=await waiter.result;
  assert.equal(first.code,0,first.error);assert.equal(last.code,0,last.error);
  if(kind==='epoch-first'){
   const stale=JSON.parse(sql(auth+write(i)));assert.equal(stale.error,'stale_manual_finish_context');
   assert.equal(read(i).error,'receipt_not_found');
   assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand}';`),'in_progress');
  }else{
   const committed=JSON.parse(first.out);assert.equal(committed.ok,true);
   // New connections recover an unknown COMMIT using the unchanged intent/key.
   assert.deepEqual(read(i),committed);
   assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND request_id='${i.request_id}';`),'1');
   if(kind==='duplicate')assert.deepEqual(JSON.parse(sql(auth+write(i))),committed);
  }
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
console.log('MANUAL_FINISH95_DUPLICATE_EPOCH_BOTH_ORDER_RECOVERY_PASS');
