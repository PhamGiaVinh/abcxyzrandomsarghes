// Native dispatcher behavior with a SQL request sink, never outbound HTTP.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {initialize,sql,jsonSql,service} from './nativeDb.mjs';
const db='vinpoker_hud_test_dispatch_url_20261107a';
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,db);
const port=process.platform==='win32'?'55441':(process.env.PUBLIC_HUD_LOCAL_PORT??'5432');
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|'+port);
if(process.argv.includes('--initialize')){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.equal(sql("SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN('public','information_schema');"),'0');
 initialize();
 sql("COMMENT ON DATABASE vinpoker_hud_test_dispatch_url_20261107a IS 'vinpoker-owned-dispatch-url-20261107a';");
}
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-dispatch-url-20261107a');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') AND (rolsuper OR rolbypassrls);"),'0');
const output=process.env.PUBLIC_HUD_DISPATCH_URL_REPORT;
if(process.platform==='win32')assert.match(output??'',/^D:\/Quy-trinh-hud-scale-evidence\/dispatch-url-native-[a-z0-9-]+\.json$/);
else{
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(process.env.RUNNER_TEMP);
 assert.equal(resolve(output??''),join(resolve(process.env.RUNNER_TEMP),'dispatch-url-native.json'));
}
assert.equal(existsSync(output),false);
assert.equal(sql("SELECT to_regnamespace('vault') IS NULL AND to_regnamespace('net') IS NULL;"),'t');
const forward=readFileSync('supabase/migrations/20261107151500_public_hud_dispatch_project_url_v1.sql','utf8');
const rollback=readFileSync('scripts/ops/public-hud-dispatch-project-url-20261107-rollback.sql','utf8');
const state=()=>sql("SELECT md5(pg_get_functiondef(oid)||coalesce(proacl::text,'')) FROM pg_proc WHERE oid='public.dispatch_public_hud_projection_v1()'::regprocedure;");
const original=state();
const source=()=>sql("SELECT md5(jsonb_build_object('hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a),'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.player_results r))::text);");
const sourceBefore=source();
sql(`CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
CREATE SCHEMA net;CREATE TABLE public.fixture_hud_http_calls(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms integer);
CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,timeout_milliseconds integer DEFAULT 1000) RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE target bigint;BEGIN INSERT INTO public.fixture_hud_http_calls(url,headers,body,timeout_ms) VALUES(url,headers,body,timeout_milliseconds) RETURNING id INTO target;RETURN target;END $$;
INSERT INTO vault.decrypted_secrets VALUES('PUBLIC_HUD_WORKER_SECRET','fixture-worker-secret');
INSERT INTO tracker_analytics_v1.jobs(kind,entity_id) VALUES('hand','de780035-0000-4000-8000-000000000001');
UPDATE tracker_analytics_v1.config SET worker_enabled=true WHERE singleton;`);
assert.equal(sql("SELECT nullif(current_setting('app.supabase_url',true),'') IS NULL;"),'t');
const call=()=>sql(service+'SELECT coalesce(public.dispatch_public_hud_projection_v1()::text,\'NULL\');');
assert.equal(call(),'NULL');assert.equal(sql('SELECT count(*) FROM public.fixture_hud_http_calls;'),'0');
const body=forward.replace(/^[\s\S]*?BEGIN;/,'').replace(/COMMIT;\s*$/,'');
let driftDenials=0;
for(const grant of [
 'GRANT EXECUTE ON FUNCTION public.dispatch_public_hud_projection_v1() TO anon;',
 'GRANT EXECUTE ON FUNCTION public.dispatch_public_hud_projection_v1() TO service_role WITH GRANT OPTION;'
]){let denied=false;try{sql('BEGIN;'+grant+body+'ROLLBACK;',{captureFailure:true});}catch(e){denied=String(e.stderr??'').includes('hud_dispatch_metadata_drift');}assert.equal(denied,true);assert.equal(state(),original);driftDenials++;}
sql(forward,{captureFailure:true});assert.equal(call(),'1');
const request=jsonSql('SELECT json_build_object(\'url\',url,\'headers\',headers,\'body\',body,\'timeout\',timeout_ms) FROM public.fixture_hud_http_calls;');
assert.deepEqual(request,{url:'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/public-hud-projector-v1',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-worker-secret'},body:{},timeout:8000});
let actorDenials=0;
for(const role of ['anon','authenticated']){let denied=false;try{sql('SET ROLE '+role+';SELECT public.dispatch_public_hud_projection_v1();',{captureFailure:true});}catch(e){denied=String(e.stderr??'').includes('permission denied');}assert.equal(denied,true);actorDenials++;}
sql('UPDATE tracker_analytics_v1.config SET worker_enabled=false WHERE singleton;');assert.equal(call(),'NULL');
sql("UPDATE tracker_analytics_v1.config SET worker_enabled=true WHERE singleton;DELETE FROM vault.decrypted_secrets;");assert.equal(call(),'NULL');
assert.equal(sql('SELECT count(*) FROM public.fixture_hud_http_calls;'),'1');
sql(rollback,{captureFailure:true});assert.equal(state(),original);assert.equal(source(),sourceBefore);
const report={kind:'NATIVE_DISPATCH_URL_WITH_SQL_SINK_NOT_NETWORK_OR_FULL35',passed:true,missingSettingPreviouslySkipped:true,canonicalFallbackRequestVerified:true,workerDisabledAndMissingSecretSkip:true,actorDenials,metadataDriftDenials:driftDenials,exactRollbackPassed:true,sourceUnchanged:true,productionChanged:false,limits:'Owned native fixture and SQL request sink. No real Edge delivery, full35 package, production role-policy compatibility or capacity claim.'};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
