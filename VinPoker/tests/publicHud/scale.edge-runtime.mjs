// Local-only runtime topology. Keep the CLI's exact generated gateway, image,
// function limits, secrets and mounts; reset CPU accounting per request rather
// than retiring a worker after cumulative CPU across concurrent requests.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {parseEnv} from 'node:util';
const [mode,root,project]=process.argv.slice(2);
assert.ok(['capture','apply'].includes(mode));
assert.match(root??'',/^\/tmp\/vinpoker-hud-stack-[A-Za-z0-9]+$/);
assert.match(project??'',/^hud-scale-[a-z0-9-]+$/);
const name=`supabase_edge_runtime_${project}`,file=root+'/runtime-private.json';
const digest=value=>createHash('sha256').update(value).digest('hex');
const inspect=()=>JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
if(mode==='capture'){
 let value;
 const secrets=parseEnv(readFileSync(root+'/workers.env','utf8'));
 for(let attempt=0;attempt<120;attempt++){
  try{const candidate=inspect();if(Object.values(secrets).every(secret=>secret.length>=32&&candidate.Config.Env.some(item=>item.includes(secret)))){value=candidate;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(value,'Configured disposable function environment did not become ready');assert.equal(value.Name,'/'+name);
 assert.deepEqual(value.Config.Entrypoint.slice(0,2),['sh','-c']);
 const shell=value.Config.Entrypoint[2];assert.equal(shell.split('--policy=per_worker').length,2);
 assert.ok(!shell.includes('--max-parallelism'));
 assert.ok(value.HostConfig.NetworkMode.includes(project));
 writeFileSync(file,JSON.stringify(value),{mode:0o600});
}else{
 const original=JSON.parse(readFileSync(file,'utf8'));assert.equal(original.Name,'/'+name);
 const shell=original.Config.Entrypoint[2];assert.equal(shell.split('--policy=per_worker').length,2);
 assert.ok(original.HostConfig.NetworkMode.includes(project));
 const request=(method,path,body)=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=http.request({socketPath:'/var/run/docker.sock',path,method,headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},response=>{
   let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>{
    if(!response.statusCode||response.statusCode>=300){reject(Error(`Local runtime Docker operation failed: ${response.statusCode}`));return;}
    resolve(text?JSON.parse(text):null);
   });
  });req.on('error',()=>reject(Error('Local runtime Docker transport failed')));req.end(payload);
 });
 // The CLI owner has exited before this phase. Remove only its captured ID,
 // never an arbitrary/recent container found under the same name.
 try{const current=inspect();assert.equal(current.Id,original.Id);await request('DELETE',`/containers/${original.Id}?force=true`);}catch(error){
  if(error?.code!=='ENOENT'&&!String(error?.stderr??'').includes('No such object'))throw error;
 }
 const config={...original.Config,Image:original.Image,Entrypoint:['sh','-c',shell.replace('--policy=per_worker','--policy=per_request --max-parallelism=16')],
  HostConfig:original.HostConfig,NetworkingConfig:{EndpointsConfig:{[original.HostConfig.NetworkMode]:{Aliases:[name]}}}};
 const created=await request('POST','/containers/create?name='+encodeURIComponent(name),config);
 assert.match(created.Id,/^[a-f0-9]{64}$/);
 await request('POST',`/containers/${created.Id}/start`);
 const actual=inspect();assert.equal(actual.Id,created.Id);assert.equal(actual.Image,original.Image);
 assert.deepEqual(actual.Config.Entrypoint,config.Entrypoint);assert.ok(JSON.stringify(actual.Config.Env)===JSON.stringify(original.Config.Env),'Disposable environment changed');
 assert.ok(JSON.stringify(actual.HostConfig.Binds)===JSON.stringify(original.HostConfig.Binds),'Disposable bind mounts changed');
 assert.equal(actual.HostConfig.NetworkMode,original.HostConfig.NetworkMode);
 for(const key of ['Memory','MemorySwap','NanoCpus','CpuQuota','CpuPeriod','PidsLimit','Ulimits'])assert.deepEqual(actual.HostConfig[key],original.HostConfig[key]);
 execFileSync('docker',['exec',`supabase_kong_${project}`,'kong','reload'],{stdio:['ignore','pipe','pipe']});
 writeFileSync('output/hud-scale/runtime-policy.json',JSON.stringify({kind:'ISOLATED_RUNTIME_CONFIGURATION_NOT_HOSTED_TOPOLOGY',image:original.Config.Image,imageId:original.Image,
  policy:'per_request',maxParallelismPerFunction:16,workerLimits:'unchanged CLI gateway: 256MB, CPU soft1000ms/hard2000ms, wall400s',
  actualConfigurationVerified:true,resourceCaps:Object.fromEntries(['Memory','MemorySwap','NanoCpus','CpuQuota','CpuPeriod','PidsLimit','Ulimits'].map(key=>[key,actual.HostConfig[key]])),
  originalGatewaySha256:digest(shell),gatewaySha256:digest(actual.Config.Entrypoint[2]),reason:'per_worker CPU retirement/WorkerAlreadyRetired under concurrent HUD reads'},null,2));
}
