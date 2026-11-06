// A bounded, disposable PostgREST pool experiment. No hosted configuration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {configureIsolatedPostgrestPool} from '../../scripts/ops/isolated-postgrest-pool.mjs';
import {sql} from './nativeDb.mjs';
const [project,root]=process.argv.slice(2),pool=Number(process.env.PUBLIC_HUD_SCALE_REST_POOL??10);
assert.match(project??'',/^hud-scale-(?:[0-9]+|local)-[0-9]+$/);assert.ok([10,20].includes(pool));
assert.match(root??'',/^\/tmp\/vinpoker-hud-stack-[A-Za-z0-9]+$/);
assert.equal(process.env.PUBLIC_HUD_ISOLATED_STACK,'vinpoker-hud-scale');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-hud-scale-disposable');
const name=`supabase_rest_${project}`;
const receipt=await configureIsolatedPostgrestPool(name,'supabase_network_'+project,pool);
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
