import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_checkin'})) assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.equal(process.env[key],undefined);
function sql(query){
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.error,undefined); assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Exact owned PG17 required'; END IF; END $$;`);
const actor=randomUUID(), secondActor=randomUUID(), club=randomUUID(), tour=randomUUID();
sql(`BEGIN; INSERT INTO auth.users(id) VALUES('${actor}'),('${secondActor}');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${club}','${actor}','Atomic concurrency TEST','TEST');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${club}','${secondActor}');
 INSERT INTO public.tournaments(id,club_id,name,live_status) VALUES('${tour}','${club}','Before overlap TEST','registering'); COMMIT;`);
const expected=sql(`SELECT updated_at FROM public.tournaments WHERE id='${tour}';`);
const request1=randomUUID(), request2=randomUUID();
const auth=`SET request.jwt.claim.sub='${actor}'; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;`;
const secondAuth=`SET request.jwt.claim.sub='${secondActor}'; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;`;
const call=(name,key)=>`SELECT public.save_tournament_config_v1('${tour}','${club}',
 jsonb_build_object('name','${name}','swing_duration_minutes',45,'warn_at_minutes',5,'crit_at_minutes',2),
 ARRAY[]::uuid[],'${expected}'::timestamptz,ARRAY[]::uuid[],'${key}',current_setting('request.jwt.claim.sub')::uuid);`;
function run(query,marker){
 return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',err='';
  p.stdout.on('data',b=>out+=b); p.stderr.on('data',b=>err+=b); p.on('error',reject);
  p.on('close',code=>code===0?resolve(out):reject(new Error(err)));
  p.stdin.end(`SET application_name='${marker}'; SET statement_timeout='8s'; ${query}`);
 });
}
async function barrier(marker,condition){
 for(let i=0;i<120;i++){
  if(sql(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t') return;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.fail(`Missing actual overlap ${marker}`);
}
const holderMarker=`config88_${request1}`, waiterMarker=`config88_${request2}`;
const holder=run(`BEGIN; ${auth} ${call('winner',request1)} SELECT pg_sleep(2); COMMIT;`,holderMarker);
await barrier(holderMarker,"wait_event='PgSleep'");
const waiter=run(`${secondAuth} ${call('stale loser',request2)}`,waiterMarker);
await barrier(waiterMarker,"wait_event_type='Lock'");
const [a,b]=await Promise.all([holder,waiter]);
const result=out=>JSON.parse(out.split(/\r?\n/).find(line=>line.startsWith('{')));
assert.equal(result(a).ok,true);
assert.equal(result(b).error,'STALE_CONFIG');
assert.equal(sql(`SELECT name FROM public.tournaments WHERE id='${tour}';`),'winner');
assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='save_tournament_config_v1';`),'1');
assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${secondActor}' AND operation_type='save_tournament_config_v1';`),'0');
assert.deepEqual(result(sql(`${auth} ${call('winner',request1)}`)),result(a));
console.log('Actual two-actor config CAS lock overlap, one receipt and lost-response replay PASS');
let nextTableNumber=1;
for(const lifecycle of ['open','close']) for(const lifecycleFirst of [true,false]) {
 const testTour=randomUUID(), physical=randomUUID(), configKey=randomUUID(), lifecycleKey=randomUUID();
 sql(`INSERT INTO public.tournaments(id,club_id,name,live_status) VALUES('${testTour}','${club}','Lifecycle overlap TEST','registering');
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES('${physical}','${club}','Lifecycle ${physical} TEST',${nextTableNumber++},'tournament','inactive','available');`);
 const open=`SELECT public.floor_open_tournament_table_v3('${testTour}','${physical}','manual','${lifecycleKey}');`;
 let table=null, revision=null;
 if(lifecycle==='close') {
  assert.equal(result(sql(`${auth} ${open}`)).ok,true);
  const row=JSON.parse(sql(`SELECT json_build_object('id',tt.id,'revision',s.revision)
   FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
   WHERE tt.tournament_id='${testTour}' AND tt.status='active';`));
  table=row.id; revision=row.revision;
 }
 const stamp=sql(`SELECT updated_at FROM public.tournaments WHERE id='${testTour}';`);
 const active=table?`ARRAY['${table}'::uuid]`:'ARRAY[]::uuid[]';
 const wanted=table?`ARRAY['${physical}'::uuid]`:'ARRAY[]::uuid[]';
 // Only test-side exception adapter: candidate deliberately raises to roll back business rejection.
 const configure=`CREATE FUNCTION pg_temp.try_config() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 RETURN public.save_tournament_config_v1('${testTour}','${club}',
 jsonb_build_object('name','config winner','swing_duration_minutes',45,'warn_at_minutes',5,'crit_at_minutes',2),
 ${wanted},'${stamp}'::timestamptz,${active},'${configKey}','${actor}');
 EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END $$;
 SELECT pg_temp.try_config();`;
 const operate=lifecycle==='open'?open:`SELECT public.close_tournament_table_v3('${table}',${revision},'${randomUUID()}');`;
 const holderName=`config88_lifecycle_${configKey}`, waiterName=`config88_lifecycle_${lifecycleKey}`;
 const first=run(`BEGIN; ${auth} ${lifecycleFirst?operate:configure} SELECT pg_sleep(2); COMMIT;`,holderName);
 await barrier(holderName,"wait_event='PgSleep'");
 const second=run(`${auth} ${lifecycleFirst?configure:operate}`,waiterName);
 await barrier(waiterName,"wait_event_type='Lock'");
 const output=await Promise.all([first,second]);
 const configResult=result(output[lifecycleFirst?1:0]);
 const operationResult=result(output[lifecycleFirst?0:1]);
 assert.equal(operationResult.ok,true,JSON.stringify(operationResult));
 if(lifecycleFirst) assert.equal(configResult.error,'STALE_TABLE_CONFIG');
 else assert.equal(configResult.ok,true,JSON.stringify(configResult));
 assert.equal(sql(`SELECT count(*) FROM public.tournament_tables WHERE tournament_id='${testTour}' AND status='active';`),lifecycle==='open'?'1':'0');
 assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='save_tournament_config_v1' AND request_id='${configKey}';`),lifecycleFirst?'0':'1');
 console.log(`${lifecycleFirst?`${lifecycle}→config`:`config→${lifecycle}`} actual lock overlap PASS`);
}
// Namespaced fixtures remain in this owned disposable database for inspection.
