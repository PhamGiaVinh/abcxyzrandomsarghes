// A bounded, disposable PostgREST pool experiment. No hosted configuration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {configureIsolatedPostgrestPool} from '../../scripts/ops/isolated-postgrest-pool.mjs';
import {sql} from './nativeDb.mjs';
import {readBoundedMetrics} from './scale.postgrest-metrics.mjs';
import {execFileSync} from 'node:child_process';
const [project,root]=process.argv.slice(2),pool=Number(process.env.PUBLIC_HUD_SCALE_REST_POOL??10);
assert.match(project??'',/^hud-scale-(?:[0-9]+|local)-[0-9]+$/);assert.ok([10,20].includes(pool));
assert.match(root??'',/^\/tmp\/vinpoker-hud-stack-[A-Za-z0-9]+$/);
assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,'vinpoker-hud-scale');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-scale-disposable');
const name=`supabase_rest_${project}`;
const diagnostics=process.env.PUBLIC_HUD_SCALE_VIEWERS==='1000'&&process.env.PUBLIC_HUD_SCALE_SECONDS==='30';
const receipt=await configureIsolatedPostgrestPool(name,'supabase_network_'+project,pool,diagnostics);
if(diagnostics){
 const address=execFileSync('docker',['inspect','--format',`{{with index .NetworkSettings.Networks "supabase_network_${project}"}}{{.IPAddress}}{{end}}`,name],{encoding:'utf8'}).trim();
 assert.match(address,/^172\.(?:1[6-9]|2[0-9]|3[01])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})$/);
 const endpoint=`http://${address}:3001/metrics`;
 let metrics;
 for(let attempt=0;attempt<30;attempt++){
  try{metrics=await readBoundedMetrics(await fetch(endpoint,{signal:AbortSignal.timeout(1000)}));if(metrics?.available)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(metrics?.available,'Isolated PostgREST pool metrics unavailable');
 assert.equal(metrics.metrics.pgrst_db_pool_max,pool);
 writeFileSync(root+'/postgrest-metrics-url',endpoint,{mode:0o600});
 receipt.metricsPreflight=metrics;
}
const status=parseEnv(readFileSync(root+'/status.env','utf8'));assert.ok(status.API_URL==='http://127.0.0.1:54321','Disposable API origin differs');
assert.ok(typeof status.ANON_KEY==='string'&&status.ANON_KEY.length>32,'Disposable anonymous key missing');
let ready=false;const deadline=Date.now()+15000;
while(Date.now()<deadline&&!ready){
 try{
  const response=await fetch(status.API_URL+'/rest/v1/',{headers:{apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`},signal:AbortSignal.timeout(1000)});
  ready=response.ok;await response.body?.cancel();
 }catch{/* Startup-only readiness retries; never print credentials/config. */}
 if(!ready)await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(ready,'Disposable PostgREST HTTP/schema readiness failed');
writeFileSync('output/hud-scale/postgrest-pool.json',JSON.stringify(receipt,null,2));
