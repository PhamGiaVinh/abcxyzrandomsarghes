// Separate bounded read-only observer; never runs on hosted Supabase.
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {audienceResourceStats,readAudiencePoolMetrics} from './operations-audience-scope.mjs';
const [container,reportFile]=process.argv.slice(2);
assert.equal(process.platform,'linux');
assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_OPERATIONS_AUDIENCE,'1000');
assert.match(container??'',/^[a-f0-9]{12,64}$/);
assert.ok(reportFile?.endsWith('/output/operations-latency/operations-db-pressure-http.json'));
const sha=process.env.LOCAL_OPERATIONS_SOURCE_SHA;assert.match(sha??'',/^[a-f0-9]{40}$/);
const docker=(args,input)=>{try{return execFileSync('docker',args,{input,encoding:'utf8',timeout:2000,maxBuffer:16384,stdio:['pipe','pipe','pipe']});}catch{throw Error('Bounded isolated database observation unavailable');}};
const name=docker(['inspect',container,'--format','{{.Name}}']).trim();
assert.match(name,/^\/supabase_db_cashier-e2e-[A-Za-z0-9]+$/);
const restName=name.slice(1).replace(/^supabase_db_/,'supabase_rest_');
const restId=docker(['inspect',restName,'--format','{{.Id}}']).trim();assert.match(restId,/^[a-f0-9]{64}$/);
const expectedNetwork=name.slice(1).replace(/^supabase_db_/,'supabase_network_');
const restNetworks=JSON.parse(docker(['inspect',restId,'--format','{{json .NetworkSettings.Networks}}']));
assert.deepEqual(Object.keys(restNetworks),[expectedNetwork]);
// Read only the numeric admin port from private config; never export config.
// If the server has no existing admin endpoint, keep that explicitly unknown.
const restConfig=docker(['exec',restId,'postgrest','--dump-config']);
const adminPort=/^admin-server-port\s*=\s*(\d+)\s*$/m.exec(restConfig)?.[1];
const poolCapability=adminPort==='3001'?'existing-admin-endpoint':'unavailable-admin-disabled-or-different-port';
const poolMetrics=async()=>{
 if(adminPort!=='3001')return {capture:'unavailable',reason:'admin-disabled-or-different-port'};
 try{return {capture:'available',...await readAudiencePoolMetrics(`http://${restNetworks[expectedNetwork].IPAddress}:3001/metrics`)};}
 catch{return {capture:'unavailable',reason:'existing-admin-read-failed'};}
};
const resource=()=>new Promise((resolve,reject)=>{
 const started=Date.now();execFile('docker',['stats','--no-stream','--no-trunc','--format','{{.CPUPerc}}|{{.MemPerc}}|{{.PIDs}}',restId],{encoding:'utf8',timeout:3000,maxBuffer:1024},(error,stdout)=>{
  if(error){reject(Error('Bounded isolated API resource observation unavailable'));return;}
  try{resolve({...audienceResourceStats(stdout),observerMs:Date.now()-started});}catch{reject(Error('Invalid isolated API resource observation'));}
 });
});
const query=readFileSync(new URL('./operations-db-pressure.sql',import.meta.url),'utf8');
const numeric=['connections','active','idle','idle_in_transaction','lock_wait','io_wait','lwlock_wait','client_wait','running','max_active_ms'];
const samples=[];let stopping=false,phase='observing',errors=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const save=()=>{writeFileSync(reportFile+'.next',JSON.stringify({kind:'ISOLATED_READ_ONLY_DATABASE_PRESSURE',sha,phase,intervalMs:2000,maxSamples:1200,errors,poolCapability,samples,qualification:false,productionChanged:false,limitations:'Direct PG states,Docker stats and optional existing PostgREST admin scalar pool gauges. No server restart/config/pool/deadline changes. Unavailable metrics remain unknown;2s samples can miss brief queues and are not per-request acquisition/GC timing. No labels,config,SQL or identities exported. Successful sampling is not workload qualification.'}));renameSync(reportFile+'.next',reportFile);};
try{
 while(!stopping&&samples.length<1200){
  const started=Date.now();
  const pendingResource=resource();void pendingResource.catch(()=>{});
  try{
   const value=JSON.parse(docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],query));
   assert.equal(value.scopeReady,true);assert.ok(Number.isSafeInteger(value.observedAtMs));assert.ok(Array.isArray(value.clients));assert.ok(value.clients.length<=2);
   for(const row of value.clients){assert.deepEqual(Object.keys(row).sort(),['client',...numeric].sort());assert.ok(['postgrest','other'].includes(row.client));for(const key of numeric)assert.ok(Number.isFinite(row[key])&&row[key]>=0);}
   // Start HTTP after the synchronous PG observation so its deadline isn't
   // held behind docker exec. Pool carries its own observation timestamps.
   const dbObserverMs=Date.now()-started,pendingPool=poolMetrics();
   const [postgrest,pool]=await Promise.all([pendingResource,pendingPool]);
   samples.push({observedAtMs:value.observedAtMs,observerMs:Date.now()-started,dbObserverMs,postgrest,pool,clients:value.clients});
  }catch{errors++;phase='failed';save();throw Error('Isolated pressure observation failed; private diagnostics withheld');}
  save();const end=started+2000;while(!stopping&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,Math.min(100,end-Date.now())));
 }
 assert.ok(stopping,'Bounded observation sample limit reached');phase='stopped';save();
}catch{phase='failed';save();console.error('Isolated pressure observation failed; private diagnostics withheld');process.exitCode=1;}
