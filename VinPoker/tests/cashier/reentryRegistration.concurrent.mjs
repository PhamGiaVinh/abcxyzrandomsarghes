import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
// Dedicated clone, never the retained paid fixture or a hosted database.
const database='vinpoker_ops_reentry115_overlap';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),database+'|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');
assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const fixture=createPaidJourneyFixture(sql),actor=fixture.actor,tour=fixture.tour;
const source=JSON.parse(sql(`SELECT to_jsonb(e) FROM public.tournament_entries e WHERE registration_id='${fixture.registration}';`));
assert.equal(source.status,'seated','requires a fresh dedicated clone, never reset a prior overlap fixture');
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
const service=`SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
const call=`SELECT public.cashier_create_app_reentry_v1('${tour}','${source.player_id}');`;
const session=JSON.parse(sql(`SELECT to_jsonb(x) FROM public.table_sessions x JOIN public.tournament_seats s ON s.table_session_id=x.id WHERE s.entry_id='${source.id}' AND s.is_active;`));
const bust=sql(`BEGIN;${auth}SELECT public.floor_bust_player_v3('${source.id}',${session.revision},${session.control_epoch},20000,gen_random_uuid(),'concurrent_reentry_TEST');COMMIT;`);
assert.equal(JSON.parse(bust.split('\n').find(l=>l.startsWith('{'))).ok,true);
function tx(name,query,hold){const child=spawn(binary,[...prefix,...flags]);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(command+';\n');};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='15s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};}
async function barrier(name,condition){for(let i=0;i<100;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail('actual overlap barrier absent: '+name);}
const parse=r=>JSON.parse(r.out.split('\n').find(l=>l.startsWith('{')));
let holder,waiter;
try{
 const suffix=randomUUID().slice(0,8),hname='reentry_holder_'+suffix,wname='reentry_waiter_'+suffix;
 holder=tx(hname,service+call,true);await barrier(hname,"wait_event='ClientRead' AND xact_start IS NOT NULL");
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id='${source.id}';`),'0','uncommitted registration invisible');
 waiter=tx(wname,service+call,false);await barrier(wname,"wait_event_type='Lock'");
 holder.end('COMMIT');const h=await holder.result,w=await waiter.result;
 assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
 const first=parse(h),second=parse(w);assert.equal(first.ok,true);assert.equal(second.ok,true);
 assert.equal(first.already_registered,false);assert.equal(second.already_registered,true);
 assert.equal(second.registration_id,first.registration_id);assert.deepEqual(second.price_snapshot,first.price_snapshot);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id='${source.id}' AND status='pending';`),'1');
 // Treat first committed response as lost: recovery is same semantic request,
 // not another registration, and does not need timestamps or a new key.
 const recovered=JSON.parse(sql(`BEGIN;${service}${call}COMMIT;`).split('\n').find(l=>l.startsWith('{')));
 assert.equal(recovered.registration_id,second.registration_id);assert.deepEqual(recovered.price_snapshot,second.price_snapshot);
 assert.equal(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${first.registration_id}';`),'0');
 console.log('REENTRY115_TRUE_TWO_SESSION_CREATE_AND_COMMITTED_RESPONSE_LOSS_PASS');
}finally{
 holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);
}
