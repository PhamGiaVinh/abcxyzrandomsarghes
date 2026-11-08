// Disposable CLI runtimes only. Callers also verify their owned database marker.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
export async function configureIsolatedPostgrestPool(name,expectedNetwork,pool){
 assert.match(name??'',/^supabase_rest_(?:hud-scale-(?:[0-9]+|local)-[0-9]+|cashier-e2e-[A-Za-z0-9]+)$/);
 assert.equal(expectedNetwork,name.replace(/^supabase_rest_/,'supabase_network_'));
 assert.ok([10,20].includes(pool));
function docker(args){try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch{throw Error('Disposable PostgREST Docker operation failed');}}
const inspect=()=>JSON.parse(docker(['inspect',name]))[0];
const original=inspect();assert.equal(original.Name,'/'+name);assert.equal(original.HostConfig.NetworkMode,expectedNetwork);
assert.match(original.Config.Image,/postgrest(?:\/postgrest)?:v14\.10$/);
const setting=()=>{
 const body=docker(['exec',name,'postgrest','--dump-config']);
 const value=/^db-pool\s*=\s*(\d+)\s*$/m.exec(body);assert.ok(value,'PostgREST pool configuration missing');return Number(value[1]);
};
const before=setting();assert.equal(before,10,'CLI baseline PostgREST pool drift');
if(pool!==before){
 const request=(method,path,body)=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=http.request({socketPath:'/var/run/docker.sock',path,method,headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},response=>{
   let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>{
    if(!response.statusCode||response.statusCode>=300){reject(Error('Disposable PostgREST replacement failed'));return;}
    resolve(text?JSON.parse(text):null);
   });
  });req.on('error',()=>reject(Error('Disposable Docker transport failed')));req.end(payload);
 });
 const env=original.Config.Env.filter(value=>!value.startsWith('PGRST_DB_POOL='));env.push(`PGRST_DB_POOL=${pool}`);
 const config={...original.Config,Env:env,HostConfig:original.HostConfig,NetworkingConfig:{EndpointsConfig:{[original.HostConfig.NetworkMode]:{Aliases:[name]}}}};
 assert.equal(inspect().Id,original.Id);await request('DELETE',`/containers/${original.Id}?force=true`);
 const created=await request('POST','/containers/create?name='+encodeURIComponent(name),config);assert.match(created.Id,/^[a-f0-9]{64}$/);
 await request('POST',`/containers/${created.Id}/start`);
 const actual=inspect();assert.equal(actual.Id,created.Id);assert.equal(actual.Image,original.Image);
 // Captured environment/configuration may contain secrets. Never let assert
 // render its actual/expected operands into a failed CI log.
 assert.ok(JSON.stringify(actual.Config.Env)===JSON.stringify(env),'Disposable environment changed unexpectedly');
 assert.ok(JSON.stringify(actual.Config.Entrypoint)===JSON.stringify(original.Config.Entrypoint),'Disposable entrypoint changed');
 assert.ok(JSON.stringify(actual.Config.Cmd)===JSON.stringify(original.Config.Cmd),'Disposable command changed');
 assert.ok(JSON.stringify(actual.HostConfig)===JSON.stringify(original.HostConfig),'Disposable resource/network configuration changed');
 assert.equal(setting(),pool);
}

 return {kind:'ISOLATED_POSTGREST_POOL_EXPERIMENT_NOT_HOSTED_CONFIGURATION',image:original.Config.Image,imageId:original.Image,baselinePool:before,pool,onlyPoolChanged:true,resourceCapsUnchanged:true};
}
