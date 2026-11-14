import {readFileSync,writeFileSync} from 'node:fs';
import {sourceBatchProbeEnabled} from './scale.write.protocol.mjs';
import {execFileSync} from 'node:child_process';
import {parseEnv as parse} from 'node:util';
import {sql} from './nativeDb.mjs';
import {configureLocalRealtime} from './scale.realtime.mjs';
const status=parse(readFileSync(process.env.PUBLIC_HUD_STATUS_FILE,'utf8'));
const secrets=parse(readFileSync(process.env.PUBLIC_HUD_WORKER_ENV_FILE,'utf8'));
const project=process.env.PUBLIC_HUD_STACK_PROJECT;
if(!/^hud-scale-[a-z0-9-]+$/.test(project)||status.API_URL!=='http://127.0.0.1:54321')throw Error('Isolated stack scope invalid');
if(sql("SELECT position('fixture_messages' IN pg_get_functiondef('realtime.send(jsonb,text,text,boolean)'::regprocedure))=0;")!=='t')throw Error('Genuine Supabase realtime.send required');
sql(`CREATE EXTENSION IF NOT EXISTS pg_cron;CREATE EXTENSION IF NOT EXISTS pg_net;CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
 CREATE FUNCTION public.fixture_provision_hud_workers_v1(p_hud text,p_spectator text,p_url text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'vinpoker-hud-scale-disposable'
  OR p_url!~'^http://supabase_kong_hud-scale-[a-z0-9-]+:8000$' THEN RAISE EXCEPTION 'fixture_scope_required'; END IF;
 PERFORM vault.create_secret(p_hud,'PUBLIC_HUD_WORKER_SECRET');PERFORM vault.create_secret(p_spectator,'PUBLIC_SPECTATOR_WORKER_SECRET');
 EXECUTE format('ALTER DATABASE postgres SET app.supabase_url=%L',p_url);
 RETURN true;
 END $$;
 REVOKE ALL ON FUNCTION public.fixture_provision_hud_workers_v1(text,text,text) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.fixture_provision_hud_workers_v1(text,text,text) TO service_role;
 NOTIFY pgrst,'reload schema';`);
// Provisioning Vault and cron is an administrator operation, separate from the
// application RPCs being qualified. Use the existing local admin, not a new role.
execFileSync('docker',['exec','-e','PGPASSWORD=postgres',`supabase_db_${project}`,'psql','-U','supabase_admin','-d','postgres','-w','-v','ON_ERROR_STOP=1','-c',
 'ALTER FUNCTION public.fixture_provision_hud_workers_v1(text,text,text) OWNER TO supabase_admin;'],{stdio:'pipe'});
execFileSync('docker',['restart',`supabase_realtime_${project}`],{stdio:'pipe'});
await configureLocalRealtime(project);
let lastStatus=0;
for(let i=0;i<60;i++){
 try{const response=await fetch(status.API_URL+'/functions/v1/public-hud-projector-v1',{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer invalid-fixture-credential'},signal:AbortSignal.timeout(3000)});lastStatus=response.status;if(response.status===401&&(await response.json()).error==='UNAUTHORIZED')break;}catch{}
 if(i===59)throw Error(`Isolated Edge worker did not start (last HTTP status ${lastStatus})`);
 await new Promise(resolve=>setTimeout(resolve,1000));
}
const response=await fetch(status.API_URL+'/rest/v1/rpc/fixture_provision_hud_workers_v1',{
 method:'POST',headers:{apikey:status.SERVICE_ROLE_KEY,Authorization:`Bearer ${status.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
 body:JSON.stringify({p_hud:secrets.PUBLIC_HUD_WORKER_SECRET,p_spectator:secrets.PUBLIC_SPECTATOR_WORKER_SECRET,p_url:`http://supabase_kong_${project}:8000`}),signal:AbortSignal.timeout(10000),
});
if(!response.ok){
 const value=await response.json().catch(()=>({}));
 const permission=typeof value.message==='string'?value.message.match(/^permission denied for (schema|table|function|database) ([a-z0-9_.]+)/):null;
 throw Error(`Isolated worker provisioning failed (${response.status}, code ${/^[A-Z0-9]{5}$/.test(value.code)?value.code:'unknown'}${permission?', '+permission[0]:''}); remaining response withheld`);
}
// Qualify the actual administrator-installed schedules under the same HUD name
// used by the release postcheck and rollback. Do not emit credentials/commands.
// Production jobs belong to postgres. Keep Vault/database provisioning under
// supabase_admin, but create cron jobs from the existing postgres connection.
if(sql('SELECT current_user;')!=='postgres')throw Error('Production-matching cron owner required');
if(sourceBatchProbeEnabled(process.env)){
 const checked=await fetch(status.API_URL+'/functions/v1/public-spectator-projector-v2',{
  method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+secrets.PUBLIC_SPECTATOR_WORKER_SECRET,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000),
 });
 if(!checked.ok)throw Error('Isolated batch worker preflight HTTP '+checked.status);
 const value=await checked.json();
 if(value.sourceMode!=='batch'||!Number.isInteger(value.claimed)||value.claimed<0||value.claimed>50||!Number.isInteger(value.processed)||value.processed<0||value.processed>value.claimed)throw Error('Isolated worker did not consume batch mode');
 writeFileSync('output/hud-scale/source-batch-mode.json',JSON.stringify({kind:'ISOLATED_BATCH_MODE_CONSUMER_PREFLIGHT',sourceMode:value.sourceMode,actualModeVerified:true,claimed:value.claimed,processed:value.processed,productionChanged:false,qualification:false},null,2));
}
sql(`SELECT cron.schedule('public-hud-projection-v1-dispatch','1 second','SELECT public.dispatch_public_hud_projection_v1()');
 SELECT cron.schedule('public-spectator-v2-dispatch','1 second','SELECT public.dispatch_public_spectator_projection_v2()');`);
const scheduleReady=sql(`SELECT count(*)=2 AND bool_and(active AND schedule='1 second' AND
 username='postgres' AND
 command=CASE jobname WHEN 'public-hud-projection-v1-dispatch' THEN 'SELECT public.dispatch_public_hud_projection_v1()'
 ELSE 'SELECT public.dispatch_public_spectator_projection_v2()' END)
 AND count(*) FILTER(WHERE jobname='public-hud-projection-v1-dispatch')=1
 AND count(*) FILTER(WHERE jobname='public-spectator-v2-dispatch')=1
 FROM cron.job WHERE jobname IN('public-hud-projection-v1-dispatch','public-spectator-v2-dispatch','public-hud-v1-dispatch');`)==='t';
if(!scheduleReady)throw Error('Isolated worker schedule identity/cadence differs from release contract');
console.log(JSON.stringify({phase:'real-edge-cron-realtime-ready',project,scheduleReady,limits:{localConnections:2000,localEventsPerSecond:20000},productionChanged:false}));
