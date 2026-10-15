import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_checkin'})) assert.equal(process.env[k],v);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.equal(process.env[key],undefined);
function sql(query){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
sql(`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Owned PG17 only'; END IF; END $$;`);
function run(query,marker){return new Promise((resolve,reject)=>{
 const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);
 p.on('close',code=>code===0?resolve(out):reject(new Error(err)));
 p.stdin.end(`SET application_name='${marker}'; SET statement_timeout='8s'; ${query}`);
});}
async function barrier(marker,condition){for(let i=0;i<120;i++){
 if(sql(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t')return;
 await new Promise(r=>setTimeout(r,25));
}assert.fail(`Missing lock overlap: ${marker}`);}
for(const deleteFirst of [true,false]){
 const actor=randomUUID(),club=randomUUID(),tour=randomUUID();
 sql(`INSERT INTO auth.users(id) VALUES('${actor}');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${club}','${actor}','Clock overlap TEST','TEST');
 INSERT INTO public.tournaments(id,club_id,name,live_status,current_level) VALUES('${tour}','${club}','Clock overlap TEST','registering',1);
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,duration_minutes) VALUES('${tour}',1,100,200,20);`);
 const start=`SET request.jwt.claim.sub='${actor}'; SELECT public.floor_start_tournament_clock('${tour}');`;
 // Direct SQL is a fault-injection seam, not proof of the browser blind editor's policy.
 const remove=`DELETE FROM public.tournament_levels WHERE tournament_id='${tour}';`;
 const holderName=`clock89_holder_${tour}`,waiterName=`clock89_waiter_${tour}`;
 const holder=run(`BEGIN; ${deleteFirst?remove:start} SELECT pg_sleep(2); COMMIT;`,holderName);
 await barrier(holderName,"wait_event='PgSleep'");
 const waiter=run(deleteFirst?start:`BEGIN; ${remove} ROLLBACK;`,waiterName);
 await barrier(waiterName,"wait_event_type='Lock'");
 const outputs=await Promise.all([holder,waiter]);
 const result=JSON.parse(outputs[deleteFirst?1:0].split(/\r?\n/).find(line=>line.startsWith('{')));
 if(deleteFirst) assert.equal(result.error,'invalid_tournament_level');
 else assert.equal(result.outcome,'clock_started');
 assert.equal(sql(`SELECT clock_started_at IS NOT NULL FROM public.tournaments WHERE id='${tour}';`),deleteFirst?'f':'t');
 assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${tour}' AND action='floor_tournament_clock_started';`),deleteFirst?'0':'1');
 console.log(`${deleteFirst?'delete→start':'start→delete rollback'} actual level-row lock overlap PASS`);
}
