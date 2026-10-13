import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['55464','55441'].includes(process.env.PGPORT));
assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_floor66_/);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(input){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:8000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
const owner=randomUUID(),other=randomUUID(),club=randomUUID(),tour=randomUUID(),physical=randomUUID();
sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${other}');
 INSERT INTO public.clubs(id,name,region,owner_id) VALUES('${club}','Restore concurrency TEST','TEST','${owner}');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${club}','${other}');
 INSERT INTO public.tournaments(id,name,club_id,status,live_status,starting_stack) VALUES('${tour}','Restore concurrency TEST','${club}','active','registering',20000);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES('${physical}','${club}','Restore TEST',78,'tournament','inactive','available');`);
const call=(actor,intent)=>JSON.parse(sql(`SET ROLE authenticated;SET request.jwt.claim.sub='${actor}';${intent}`));
const opened=call(owner,`SELECT public.floor_open_tournament_table_v3('${tour}','${physical}','manual','${randomUUID()}');`);
assert.equal(opened.ok,true);const table=opened.tournament_table_id,session=opened.table_session_id;
function connection(name){
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',err='';
 const timer=setTimeout(()=>child.kill(),25000);
 const done=new Promise((resolve,reject)=>{child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});});
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';\n`);
 return {child,done};
}
async function barrier(query){const end=Date.now()+5000;while(Date.now()<end){if(sql(query)==='t')return;await new Promise(r=>setTimeout(r,40));}assert.fail('actual backend overlap not observed');}
function parse(r){assert.equal(r.code,0,r.err);return JSON.parse(r.out.split('\n').find(v=>v.startsWith('{')));}
for(const sameKey of [true,false]){
 let revision=Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
 const created=call(owner,`SELECT public.floor_add_manual_player_v1('${tour}','Restore TEST','${table}',1,'${session}',${revision},1,'${randomUUID()}','${owner}');`);
 assert.equal(created.ok,true);const entry=created.entry_id;
 const busted=call(owner,`SELECT public.floor_bust_player_v3('${entry}',${created.revision},1,20000,'${randomUUID()}','restore_overlap_TEST');`);
 assert.equal(busted.ok,true);revision=Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
 const key=randomUUID(),tag=randomUUID().slice(0,8),firstName=`restore68_first_${tag}`,secondName=`restore68_second_${tag}`;
 const intent=k=>`SELECT public.floor_restore_busted_player_to_seat_v5('${entry}','${table}',1,${revision},1,'${k}','${session}');`;
 const first=connection(firstName);let second;
 try{
  first.child.stdin.write(`SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${owner}';${intent(key)}\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${firstName}' AND state='idle in transaction');`);
  second=connection(secondName);
  second.child.stdin.end(`SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${sameKey?owner:other}';${intent(sameKey?key:randomUUID())}COMMIT;\n`);
  await barrier(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${firstName}' WHERE b.application_name='${secondName}' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));`);
 }finally{first.child.stdin.end('COMMIT;\n');}
 const winner=parse(await first.done),waiter=parse(await second.done);assert.equal(winner.ok,true);
 if(sameKey)assert.deepEqual(waiter,winner);else assert.equal(waiter.error,'entry_not_busted');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${entry}' AND is_active;`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='${entry}' AND status IN ('issued','printed') AND cancelled_at IS NULL;`),'1');
 const ticket=call(owner,`SELECT public.get_current_floor_seat_ticket_v1('${tour}','${entry}','${winner.seat_id}');`);
 assert.equal(ticket.ok,true);assert.equal(Number(ticket.stack_at_issue),20000);
 assert.deepEqual(call(owner,intent(key)),winner); // discarded response recovered after commit
 const old=call(owner,`SELECT public.get_floor_seat_ticket_v1('${tour}','${entry}','${created.receipt_code}');`);
 assert.equal(old.error,'ticket_not_current');
 assert.equal(sql(`SELECT e.seat_id='${winner.seat_id}'::uuid AND e.current_stack=20000 FROM public.tournament_entries e WHERE e.id='${entry}';`),'t');
 revision=Number(sql(`SELECT revision FROM public.table_sessions WHERE id='${session}';`));
 assert.equal(call(owner,`SELECT public.floor_bust_player_v3('${entry}',${revision},1,20000,'${randomUUID()}','restore_overlap_cleanup_TEST');`).ok,true);
 console.log(`RESTORE68_TRUE_OVERLAP_${sameKey?'SAME_KEY':'TWO_ACTORS'}_PASS`);
}
