import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
// Real handler control flow; modeled Supabase/auth/validation transport. Not
// HTTP, deployed Edge, RLS, bank or notification delivery verification.
const source=readFileSync(new URL('../../supabase/functions/tournament-reentry/index.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.ES2022,true);
const stripped=ts.factory.updateSourceFile(ast,ast.statements.filter(n=>!ts.isImportDeclaration(n)));
const body=ts.transpileModule(ts.createPrinter().printFile(stripped),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness(options={}){
 const calls=[];let handler;
 const registration={ok:true,already_registered:true,registration_id:'reg-stored',status:'pending',reference_code:'REENTRY-STORED',total_pay:103000,
  committed_at:'2026-10-16T00:00:00Z',price_snapshot:{buy_in:100000,rake:1000,service_fee:2000,platform_fee:0},...options.registration};
 const client={auth:{getUser:async()=>options.authStatus!==undefined?{data:null,error:{status:options.authStatus}}:{data:{user:{id:'verified-player'}},error:null}},
  rpc:async(name,args)=>{calls.push({name,args});return options.rpcFailure?{data:null,error:{message:'unavailable'}}:{data:registration,error:null};},
  from(table){const filters=[];calls.push({table,filters});const query={select:()=>query,eq:(k,v)=>{filters.push([k,v]);return query;},
   is:(k,v)=>{filters.push([k,v]);return query;},order:()=>query,limit:()=>query,maybeSingle:()=>query,
   insert:()=>{calls.push({insert:table});return query;},then(resolve,reject){
    const data=table==='tournaments'?{id:'tour-verified',name:'TEST',club_id:'club-test'}:
     table==='platform_bank_accounts'?{id:'bank-test',bank_name:'TEST',account_number:'TEST',account_holder:'TEST',qr_code_url:null,bank_bin:'TEST'}:null;
    return Promise.resolve({data:options.failTable===table?null:data,error:options.failTable===table?{message:'backend failed'}:null}).then(resolve,reject);
   }};return query;}};
 const z={object:()=>({}),string:()=>({uuid:()=>({})})};
 new Function('Deno','createClient','retryFetch','parseBody','z',body)(
  {serve:cb=>handler=cb,env:{get:()=> 'TEST_ONLY'}},()=>client,fetch,async req=>({ok:true,data:await req.json()}),z);
 return {calls,async run(){const response=await handler(new Request('https://test.invalid/tournament-reentry',{method:'POST',
  headers:{Authorization:'Bearer TEST_ONLY','Content-Type':'application/json'},body:JSON.stringify({tournament_id:'tour-verified',player_id:'forged-player',total_pay:1})}));
  return {status:response.status,body:await response.json()};}};
}
test('uses verified player and persisted snapshot, not request price or current tournament price',async()=>{
 const h=harness(),r=await h.run();assert.equal(r.status,200);assert.equal(r.body.total_pay,103000);
 assert.deepEqual(r.body.breakdown,{buy_in:100000,club_fee:1000,service_fee:2000,platform_fee:0});
 assert.deepEqual(h.calls.filter(c=>c.name),[{name:'cashier_create_app_reentry_v1',args:{p_tournament_id:'tour-verified',p_player_id:'verified-player'}}]);
 assert.equal(h.calls.some(c=>c.table==='tournament_registrations'||c.insert),false,'resuming does not insert or notify');
});
for(const table of ['tournaments','platform_bank_accounts'])test(`${table} failure is unavailable and never creates a registration`,async()=>{
 const h=harness({failTable:table}),r=await h.run();assert.equal(r.status,503);assert.equal(h.calls.some(c=>c.name),false);
});
test('unknown RPC outcome is not retried and never notifies',async()=>{
 const h=harness({rpcFailure:true}),r=await h.run();assert.equal(r.status,503);assert.equal(h.calls.filter(c=>c.name).length,1);assert.equal(h.calls.some(c=>c.insert),false);
});
test('unverified legacy price returns explicit denial, not an invented quote',async()=>{
 const r=await harness({registration:{ok:false,error:'legacy_reentry_price_requires_review'}}).run();assert.equal(r.status,400);assert.equal(r.body.error,'legacy_reentry_price_requires_review');
});
test('malformed stored price is unavailable, not zero or newly computed',async()=>{
 const r=await harness({registration:{price_snapshot:null}}).run();assert.equal(r.status,503);
});
for(const status of [0,503])test(`auth infrastructure ${status} is unavailable without privileged reads`,async()=>{
 const h=harness({authStatus:status}),r=await h.run();assert.equal(r.status,503);assert.equal(h.calls.length,0);
});
test('invalid token is denied without privileged reads',async()=>{
 const h=harness({authStatus:401}),r=await h.run();assert.equal(r.status,401);assert.equal(h.calls.length,0);
});
