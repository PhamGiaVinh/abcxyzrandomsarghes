import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_finish_move_ci');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(query){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet;"),'t');
const argument=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const parse=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
function tx(name,query,hold=false){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){for(let i=0;i<150;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail(`missing actual overlap ${name}`);}
for(const cancelFirst of [true,false]){
 const prefix=randomUUID().slice(0,8),actor=`${prefix}-0000-4000-8000-000000000001`,tour=`${prefix}-0000-4000-8000-000000000003`;
 const marker=' -- DEFERRED_CONCURRENCY_FIXTURE_READY';
 const source=readFileSync('tests/floorProduction/deferredMoveIntent.pg17.sql','utf8');assert.equal(source.split(marker).length,2);
 sql(source.replaceAll('f7290000',prefix).replace(marker,' RETURN;\n'+marker).replace('ROLLBACK;','COMMIT;'));
 const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const invoke=query=>sql(`BEGIN;${auth}${query}COMMIT;`);
 const table=number=>JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT t.id,t.table_session_id,s.revision,s.control_epoch FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${tour}' AND t.table_number=${number})x;`));
 const from=table(81),to=table(82);
 const entry=sql(`SELECT entry_id FROM public.tournament_seats WHERE tournament_table_id='${from.id}' AND is_active;`);
 const queued=parse(invoke(`SELECT public.move_player_seat_v5('${entry}','${from.id}','${from.table_session_id}','${to.id}','${to.table_session_id}',3,${from.revision},${to.revision},${from.control_epoch},${to.control_epoch},'Finish cancel overlap TEST','${randomUUID()}');`));assert.equal(queued.queued,true);
 const move=sql(`SELECT id FROM public.floor_pending_tracker_moves WHERE entry_id='${entry}' AND status='pending';`);
 const current=table(82);
 const pending=parse(invoke(`SELECT public.floor_request_table_control_mode_v4('${to.id}','${to.table_session_id}','manual',${current.revision},${current.control_epoch},'${randomUUID()}');`));assert.equal(pending.outcome,'pending');
 const intent=JSON.parse(sql(`SELECT jsonb_build_object('actor_id','${actor}','request_id',gen_random_uuid(),'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,'hand_id',h.id,'table_session_id',h.table_session_id,'control_epoch',s.control_epoch,'source_revision',h.source_revision,'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object('player_id',p.player_id,'entry_number',p.entry_number,'seat_number',p.seat_number,'starting_stack',p.starting_stack,'ending_stack',p.starting_stack,'is_eliminated',false)) FROM public.hand_players p WHERE p.hand_id=h.id),'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) FROM public.tournament_hands h JOIN public.table_sessions s ON s.id=h.table_session_id WHERE h.tournament_id='${tour}' AND h.status='in_progress';`));
 const finish=`SELECT public.record_tracker_manual_hand_v1(${argument(intent)});SET CONSTRAINTS ALL IMMEDIATE;`;
 const cancel=`SELECT public.floor_cancel_pending_tracker_move_v1('${move}');SET CONSTRAINTS ALL IMMEDIATE;`;
 let holder,waiter;
 try{
  holder=tx(`move_finish_holder_${prefix}`,auth+(cancelFirst?cancel:finish),true);
  await barrier(`move_finish_holder_${prefix}`,"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx(`move_finish_waiter_${prefix}`,auth+(cancelFirst?finish:cancel));
  if(cancelFirst){const busy=await waiter.result;assert.equal(busy.code,0,busy.error);assert.equal(parse(busy.out).error,'manual_finish_busy');}
  else await barrier(`move_finish_waiter_${prefix}`,"wait_event_type='Lock'");
  holder.end('COMMIT');const first=await holder.result,last=await waiter.result;
  assert.equal(first.code,0,first.error);assert.equal(last.code,0,last.error);
  const committed=cancelFirst?parse(invoke(finish)):parse(first.out);assert.equal(committed.status,'success');
  if(!cancelFirst){assert.equal(parse(last.out).status,'applied');assert.equal(parse(last.out).already_resolved,true);}
  assert.deepEqual(parse(invoke(`SELECT public.get_tracker_manual_finish_receipt_v1(${argument(intent)});`)),committed);
  assert.deepEqual(parse(invoke(finish)),committed);
  assert.equal(sql(`SELECT status FROM public.floor_pending_tracker_moves WHERE id='${move}';`),cancelFirst?'cancelled':'applied');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1');
  assert.equal(sql(`SELECT table_session_id FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),cancelFirst?from.table_session_id:to.table_session_id);
  assert.equal(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'60000');
  assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}';`),cancelFirst?'0':'1');
  assert.equal(sql(`SELECT control_mode||','||(control_epoch=${intent.control_epoch}+1)::text FROM public.table_sessions WHERE id='${to.table_session_id}';`),'manual,true');
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='record_tracker_manual_hand_v1' AND request_id='${intent.request_id}';`),'1');
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
console.log('SCOPED_FINISH_MOVE_CANCEL_TRUE_BOTH_ORDER_OVERLAP_RECEIPT_CONSERVATION_PASS');
