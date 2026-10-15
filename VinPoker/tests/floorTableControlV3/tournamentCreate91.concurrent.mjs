import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Fresh owned clone only. Committed synthetic fixtures remain for inspection.
const database='vinpoker_ops_tournament_create91_overlap';
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const port='55441';
const command=process.platform==='win32'?'wsl':'psql';
function args(app='create91-observer'){
 const psql=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database];
 return process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env',`PGAPPNAME=${app}`,'psql',...psql]:psql;
}
function execute(sql){
 const r=spawnSync(command,args(),{input:sql,encoding:'utf8',env:{...process.env,PGAPPNAME:'create91-observer'}});
 assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout.trim();
}
const guard=`DO $$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'wrong_owned_overlap91_target'; END IF; END $$;`;
execute(`BEGIN;${guard}
 INSERT INTO auth.users(id) VALUES('e9110000-0000-4000-8000-000000000001');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e9110000-0000-4000-8000-000000000011','e9110000-0000-4000-8000-000000000001','Overlap91 TEST','TEST');
 COMMIT;`);
const request=`'e9110000-0000-4000-8000-000000000011',
 '{"name":"Overlap91 TEST","start_time":"2026-10-20T05:00:00Z","buy_in":1000000,"rake_amount":0,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}',
 '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',
 'e9110000-0000-4000-8000-000000000021','e9110000-0000-4000-8000-000000000001'`;
const context=`SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='15s';
 SET LOCAL request.jwt.claim.sub='e9110000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated;`;
function start(app,sql){
 const child=spawn(command,args(app),{env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{
  if(code!==0)reject(new Error(err+out));else resolve(out);
 });});
 child.stdin.end(sql);return completed;
}
async function observe(predicate,message){
 const deadline=Date.now()+12_000;
 while(Date.now()<deadline){
  if(execute(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${predicate});`)==='t')return;
  await delay(50);
 }
 throw new Error(message);
}
const first=start('create91-first',`BEGIN;${context}
 SELECT public.create_tournament_with_levels_v1(${request});
 RESET ROLE;SELECT pg_sleep(8);COMMIT;`);
await observe("application_name='create91-first' AND wait_event='PgSleep'",'first writer never reached transaction barrier');
const second=start('create91-second',`BEGIN;${context}SELECT public.create_tournament_with_levels_v1(${request});COMMIT;`);
await observe("application_name='create91-second' AND cardinality(pg_blocking_pids(pid))>0",'second writer never overlapped or blocked');
const outputs=await Promise.all([first,second]);
const receipts=outputs.map(out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{'))));
assert.equal(receipts[0].ok,true);assert.deepEqual(receipts[0],receipts[1]);
const counts=JSON.parse(execute(`SELECT json_build_object(
 'parents',(SELECT count(*) FROM public.tournaments WHERE club_id='e9110000-0000-4000-8000-000000000011'),
 'levels',(SELECT count(*) FROM public.tournament_levels WHERE tournament_id='${receipts[0].tournament_id}'),
 'receipts',(SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='e9110000-0000-4000-8000-000000000001' AND operation_type='create_tournament_with_levels_v1'));`));
assert.deepEqual(counts,{parents:1,levels:1,receipts:1});
const recovered=execute(`BEGIN;${context}SELECT public.get_tournament_create_receipt_v1(${request});ROLLBACK;`);
assert.deepEqual(JSON.parse(recovered),receipts[0]);
console.log('CREATE91_TWO_CONNECTIONS_TRUE_BLOCKING_SAME_KEY_ONE_PARENT_LEVEL_RECEIPT_AND_NEW_CONNECTION_RECOVERY_PASS');
