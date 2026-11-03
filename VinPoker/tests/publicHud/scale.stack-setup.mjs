import {readFileSync} from 'node:fs';
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
 PERFORM cron.schedule('public-hud-v1-dispatch','1 second','SELECT public.dispatch_public_hud_projection_v1()');
 PERFORM cron.schedule('public-spectator-v2-dispatch','1 second','SELECT public.dispatch_public_spectator_projection_v2()');RETURN true;
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
console.log(JSON.stringify({phase:'real-edge-cron-realtime-ready',project,limits:{localConnections:2000,localEventsPerSecond:20000},productionChanged:false}));
