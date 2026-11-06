// Explicit disposable pool comparison; never a hosted configuration command.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname} from 'node:path';
import {configureIsolatedPostgrestPool} from './isolated-postgrest-pool.mjs';
const [container,statusPath,reportPath]=process.argv.slice(2);
assert.equal(process.platform,'linux');
assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.equal(process.env.LOCAL_OPERATIONS_AUDIENCE,'1000');
const pool=Number(process.env.LOCAL_OPERATIONS_REST_POOL??10);assert.ok([10,20].includes(pool));
assert.match(container??'',/^[a-f0-9]{12,64}$/);
assert.match(statusPath??'',/^\/tmp\/cashier-e2e-[A-Za-z0-9]+\/isolated-status\.json$/);
assert.ok(reportPath?.endsWith('/output/operations-latency/operations-postgrest-pool-http.json'));
const project=basename(dirname(statusPath));
const docker=(args)=>{try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});}catch{throw Error('Owned isolated pool preflight unavailable');}};
assert.equal(docker(['inspect',container,'--format','{{.Name}}']).trim(),'/supabase_db_'+project);
const owned=docker(['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',
 "SELECT current_database()='postgres' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='vinpoker-operational-schema-fence-disposable' AND EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND NOT frozen AND admission_at IS NULL);"]).trim();
assert.equal(owned,'t','Owned pre-admission database required');
const receipt=await configureIsolatedPostgrestPool('supabase_rest_'+project,'supabase_network_'+project,pool);
const status=JSON.parse(readFileSync(statusPath,'utf8'));assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.ok(typeof status.ANON_KEY==='string'&&status.ANON_KEY.length>32,'Anonymous readiness key missing');
let ready=false;const deadline=Date.now()+15000;
while(Date.now()<deadline&&!ready){
 try{const response=await fetch(status.API_URL+'/rest/v1/',{headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+status.ANON_KEY},signal:AbortSignal.timeout(1000)});ready=response.ok;await response.body?.cancel();}catch{/* Startup only; no credentials exported. */}
 if(!ready)await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(ready,'Isolated PostgREST schema startup failed');
writeFileSync(reportPath,JSON.stringify({...receipt,qualification:false,productionChanged:false},null,2));
