import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
// Real candidate handler, modeled Auth/RPC. No bank, RLS, payment or HTTP claim.
const source=readFileSync(new URL('../../supabase/pending-tests/tournament-reentry-transport.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('candidate.ts',source,ts.ScriptTarget.ES2022,true);
const stripped=ts.factory.updateSourceFile(ast,ast.statements.filter(n=>!ts.isImportDeclaration(n)));
const body=ts.transpileModule(ts.createPrinter().printFile(stripped),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness(options={}){
 let handler;const calls=[];
 const client={auth:{getUser:async(token)=>{calls.push({auth:true,token});return options.authStatus!==undefined
  ?{data:null,error:{status:options.authStatus}}:{data:{user:options.missingUser?null:{id:'verified-player'}},error:null};}},
  rpc:async(name,args)=>{calls.push({name,args});if(options.throwRpc)throw Error('private-error');
   return {data:options.envelope===undefined?{status:200,body:{success:true,total_pay:103000}}:options.envelope,error:options.rpcError?{message:'private-error'}:null};},
  from(){assert.fail('candidate must not perform sequential table requests');}};
 const z={object:()=>({}),string:()=>({uuid:()=>({})})};
 new Function('Deno','createClient','retryFetch','parseBody','z',body)(
  {serve:cb=>handler=cb,env:{get:()=> 'TEST_ONLY'}},()=>client,fetch,
  async req=>options.invalidBody?{ok:false,response:new Response('{}',{status:400})}:{ok:true,data:await req.json()},z);
 return {calls,async run(method='POST',withAuth=true){
  const response=await handler(new Request('https://test.invalid/reentry',{method,
   headers:withAuth?{Authorization:'Bearer TEST_ONLY','Content-Type':'application/json'}:{},
   ...(['GET','OPTIONS'].includes(method)?{}:{body:JSON.stringify({tournament_id:'tour-test',player_id:'forged-player',total_pay:1})})}));
  return {status:response.status,body:method==='OPTIONS'?null:await response.json(),timing:response.headers.get('server-timing')};
 }};
}
test('only verified Auth player and tour reach one privileged RPC',async()=>{
 const h=harness(),r=await h.run();assert.equal(r.status,200);assert.equal(r.body.total_pay,103000);
 assert.deepEqual(h.calls.filter(c=>c.name),[{name:'cashier_app_reentry_transport_v1',args:{p_tournament_id:'tour-test',p_player_id:'verified-player'}}]);
 assert.match(r.timing,/reentry_auth;/);assert.match(r.timing,/reentry_registration;/);assert.match(r.timing,/reentry_total;/);
 assert.doesNotMatch(r.timing,/TEST_ONLY|verified-player|103000|private-error/);
});
for(const status of [0,401,403,503])test(`Auth failure${status} prevents privileged call`,async()=>{
 const h=harness({authStatus:status}),r=await h.run();assert.equal(r.status,status===0||status>=500?503:401);
 assert.equal(h.calls.filter(c=>c.name).length,0);
});
test('missing token/user,invalid body and unsupported methods do not invoke RPC',async()=>{
 for(const [options,method,auth,status]of [[{},'POST',false,401],[{missingUser:true},'POST',true,401],
  [{invalidBody:true},'POST',true,400],[{},'GET',true,405],[{},'OPTIONS',false,200]]){
  const h=harness(options),r=await h.run(method,auth);assert.equal(r.status,status);assert.equal(h.calls.filter(c=>c.name).length,0);
 }
});
for(const status of [200,400,404,409,503])test(`mapped canonical envelope${status} preserved`,async()=>{
 const envelope={status,body:status===200?{success:true}:{error:'Mapped rejection'}};
 const h=harness({envelope}),r=await h.run();assert.equal(r.status,status);assert.deepEqual(r.body,envelope.body);
 assert.equal(h.calls.filter(c=>c.name).length,1);
});
for(const envelope of [null,{}, {status:500,body:{}},{status:200,body:[]},{status:200,body:null}])test(`malformed envelope${JSON.stringify(envelope)} is unavailable`,async()=>{
 const h=harness({envelope}),r=await h.run();assert.equal(r.status,503);assert.equal(h.calls.filter(c=>c.name).length,1);
});
test('unknown RPC outcome is not retried or converted to success',async()=>{
 for(const options of [{rpcError:true},{throwRpc:true}]){
  const h=harness(options),r=await h.run();assert.equal(r.status,options.throwRpc?500:503);
  assert.deepEqual(r.body,{error:'Re-entry unavailable'});assert.equal(h.calls.filter(c=>c.name).length,1);
 }
});
