import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';

// Only the already network-isolated disposable Docker fixture. No remote DSN.
const [container,report,sha]=process.argv.slice(2);
assert.match(container??'',/^[a-f0-9]{12,64}$/);assert.match(sha??'',/^[a-f0-9]{40}$/);
assert.match(process.env.GITHUB_RUN_ID??'',/^\d+$/);
assert.equal(process.env.LOCAL_REENTRY_TRANSPORT_PROBE,'1');
assert.equal(process.env.LOCAL_REENTRY_FAULT_MODE,'failure-injection');
const name=execFileSync('docker',['inspect',container,'--format','{{.Name}}'],{encoding:'utf8'}).trim();
const owned=/^\/supabase_db_(cashier-e2e-[A-Za-z0-9]{8})$/.exec(name);assert.ok(owned,'owned disposable database name required');
const network=`supabase_network_${owned[1]}`;
const networks=JSON.parse(execFileSync('docker',['inspect',container,'--format','{{json .NetworkSettings.Networks}}'],{encoding:'utf8'}));
assert.deepEqual(Object.keys(networks),[network]);
const networkId=execFileSync('docker',['network','inspect',network,'--format','{{.Id}}'],{encoding:'utf8'}).trim();assert.match(networkId,/^[a-f0-9]{64}$/);
execFileSync('sudo',['iptables','-w','-C','DOCKER-USER','-i','br-'+networkId.slice(0,12),'-j','CASHIER_E2E'],{stdio:'pipe'});
execFileSync('sudo',['iptables','-w','-C','CASHIER_E2E','-j','REJECT'],{stdio:'pipe'});
const flags=['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres'];
const query=sql=>{try{return execFileSync('docker',['exec','-i',container,...flags],{input:sql,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();}
 catch(cause){const state=/\b(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/.exec(String(cause.stderr??''))?.[1]??'unknown';throw Error('owned_native_sql_failed:'+state);}};
assert.equal(query(`SELECT current_database()='postgres' AND EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST') AND EXISTS(SELECT 1 FROM ops_reentry_transport_probe_v1.bank_probe_before WHERE singleton AND snapshot=ops_reentry_transport_probe_v1.bank_probe_source_snapshot());`),'t');
const snapshot=()=>query(`SELECT jsonb_build_object('base',ops_reentry_transport_probe_v1.bank_probe_source_snapshot(),
 'seats',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.tournament_seats s),
 'sessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.table_sessions s),
 'tours',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.tournaments s),
 'notifications',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.notifications s));`);
const before=snapshot();
const timeoutSql=readFileSync(new URL('../../supabase/pending-tests/reentry_transport_timeout_rollback.sql',import.meta.url),'utf8');
const boundary='UPDATE ops_reentry_transport_probe_v1.timeout_mode SET enabled=true WHERE singleton;';
assert.equal(timeoutSql.split(boundary).length,2);
// Reuse the exact canonical Auth Floor bust and owned fixture guards.
const prelude=timeoutSql.split(boundary)[0];
const service=`SET LOCAL statement_timeout='30s';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
const application='vinpoker-reentry-disconnect-probe';
let child,done,terminal=false;
const drain=async()=>{let timer;try{return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned_backend_drain_timeout')),5000);})]);}finally{clearTimeout(timer);}};
const probe=()=>JSON.parse(query(`SELECT jsonb_build_object('count',count(*),'pid',min(pid),'sleeping',bool_and(state='active' AND wait_event='PgSleep')) FROM pg_stat_activity WHERE datname='postgres' AND usename='postgres' AND backend_type='client backend' AND application_name='${application}';`));
try{
 assert.equal(probe().count,0,'owned probe application already exists');
 child=spawn('docker',['exec','-i','-e',`PGAPPNAME=${application}`,container,...flags],{stdio:['pipe','pipe','pipe']});
 let stderr='';child.stdout.resume();child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString();});
 done=new Promise(resolve=>{child.on('close',code=>{terminal=true;resolve({code,terminatedSqlState:/\b57P01\b/.test(stderr)});});child.on('error',()=>{terminal=true;resolve({code:-1,terminatedSqlState:false});});});
 child.stdin.on('error',()=>{});
 child.stdin.end(prelude+service+`DO $$ BEGIN PERFORM public.cashier_app_reentry_transport_v1('a3000000-0000-4000-8000-000000000001',current_setting('test.reentry_timeout_player')::uuid);RAISE EXCEPTION 'disconnect_probe_was_not_terminated';END $$;ROLLBACK;`);
 let waiting;const deadline=Date.now()+7000;
 while(Date.now()<deadline&&!terminal){waiting=probe();if(waiting.count===1&&waiting.sleeping===true)break;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(waiting?.count,1);assert.equal(waiting?.sleeping,true,'actual notification sleep barrier required');
 assert.equal(query(`SELECT pg_terminate_backend(${Number(waiting.pid)}) WHERE EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${Number(waiting.pid)} AND application_name='${application}' AND datname='postgres' AND usename='postgres' AND wait_event='PgSleep');`),'t');
 const result=await drain();
 assert.notEqual(result.code,0);assert.equal(result.terminatedSqlState,true);assert.equal(probe().count,0);
 assert.equal(query(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ops_reentry_transport_probe_v1.notification_disconnect_attempts;`),'1');
 assert.equal(snapshot(),before,'connection termination must roll back pending entry and canonical bust');
 // Retry the unchanged canonical core twice in a fresh rolled-back transaction.
 // This avoids adding optional notification attempts to the20-actor HTTP test.
 query(prelude+service+`DO $$ DECLARE first_result jsonb;again jsonb;BEGIN
 first_result:=public.cashier_create_app_reentry_v1('a3000000-0000-4000-8000-000000000001',current_setting('test.reentry_timeout_player')::uuid);
 again:=public.cashier_create_app_reentry_v1('a3000000-0000-4000-8000-000000000001',current_setting('test.reentry_timeout_player')::uuid);
 IF first_result->>'ok' IS DISTINCT FROM 'true' OR first_result->>'already_registered' IS DISTINCT FROM 'false'
 OR again->>'already_registered' IS DISTINCT FROM 'true' OR first_result->>'registration_id' IS DISTINCT FROM again->>'registration_id'
 OR (SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id=current_setting('test.reentry_timeout_source_entry')::uuid AND player_id=current_setting('test.reentry_timeout_player')::uuid)<>1
 THEN RAISE EXCEPTION 'disconnect_retry_not_single_pending_registration';END IF;END $$;ROLLBACK;`);
 assert.equal(snapshot(),before);
 writeFileSync(report,JSON.stringify({kind:'REAL_PG_BACKEND_TERMINATION_DURING_REENTRY_NOTIFICATION',sha,notificationSleepReached:true,backendTerminated:true,terminationSqlState:'57P01',sourceRollbackPreserved:true,canonicalRetrySinglePending:true,retryOuterRollbackPreserved:true,edgeHttp:false,committedPayment:false,qualification:false,productionChanged:false,
  limitations:'One owned PostgreSQL backend terminated during actual composite notification trigger,after canonical Auth Floor bust. Source registrations/entries/movements/seats/sessions/tours/notifications unchanged. Fresh canonical-core retry creates one pending row and recovers it;retry transaction rolled back. Not verified-player Edge mid-request disconnect or committed-payment proof.'},null,2),{mode:0o600,flag:'wx'});
}finally{
 try{if(child&&!terminal){const active=probe();if(active.count===1)query(`SELECT pg_terminate_backend(${Number(active.pid)}) WHERE EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${Number(active.pid)} AND application_name='${application}' AND datname='postgres' AND usename='postgres');`);try{await drain();}catch{child.kill('SIGKILL');throw Error('owned_backend_cleanup_timeout');}}}
 finally{assert.equal(snapshot(),before,'failure cleanup must preserve source');}
}
