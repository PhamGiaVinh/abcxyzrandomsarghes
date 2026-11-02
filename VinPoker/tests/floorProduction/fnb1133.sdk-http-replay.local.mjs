import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {createClient} from '@supabase/supabase-js';
assert.equal(process.cwd().replaceAll('\\','/'),'D:/wt/vinpoker-ops-local-integration/VinPoker');
assert.equal(process.env.VINPOKER_FNB1133_LOCAL,'1');
const output='D:/Quy trình/output/reports/fnb1133-sdk-http-replay-local-20261027.json';assert.equal(existsSync(output),false);
const nativePath='D:/Quy trình/output/reports/fnb1119-stocktake-receipt-native-local-20261027.json';
const nativeBytes=readFileSync(nativePath),native=JSON.parse(nativeBytes);assert.equal(native.unchanged,true);assert.equal(native.retainedWrites,0);
const receipt=native.observations.find(x=>x.kind==='commit_receipt');assert.equal(receipt.count,1);
const source=readFileSync('src/lib/fnbStocktakeOperationReceipt.ts','utf8'),sourceHash=createHash('sha256').update(source).digest('hex');assert.equal(sourceHash,native.clientProofs.sourceSha256);
const {resolveStocktakeOperationReceipt}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'strip'})).toString('base64'));
const actor=receipt.row.created_by,club=receipt.row.club_id,session=receipt.row.id,ingredient=receipt.lines[0].ingredient_id;
const intent={actorId:actor,clubId:club,backend:'http://127.0.0.1:54533',requestId:'50000000-0000-4000-8000-000000001133',kind:'commit',sessionId:session,counts:{[ingredient]:'1.250'}};
const columns='stocktake_id,club_id,ingredient_id,counted_qty::text,expected_qty::text,delta_applied::text';
const state={kind:'REAL_SUPABASE_SDK_HTTP_REPLAY_OF_HISTORICAL_NATIVE_SNAPSHOT_NOT_BROWSER_OR_LIVE_DB_OR_POSTGREST',sourceHash,nativeArtifactSha256:createHash('sha256').update(nativeBytes).digest('hex'),requests:[],cases:[],errors:[],success:false,retainedWrites:0};
let mode='valid';
const server=createServer((req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:54533');assert.equal(req.method,'GET');assert.equal(url.pathname,'/rest/v1/fnb_stocktake_lines');assert.equal(url.searchParams.get('select'),columns);assert.equal(url.searchParams.get('club_id'),'eq.'+club);assert.equal(url.searchParams.get('stocktake_id'),'eq.'+session);assert.equal(url.searchParams.get('limit'),'2');assert.equal(req.headers.prefer,'count=exact');
 state.requests.push({mode,method:req.method,path:url.pathname,select:url.searchParams.get('select'),prefer:req.headers.prefer,limit:url.searchParams.get('limit')});
 let rows=structuredClone(receipt.lines);if(mode==='numeric-json')rows[0].counted_qty=1.25;if(mode==='changed-count')rows[0].counted_qty='1.75';
 const headers={'content-type':'application/json','cache-control':'no-store'};if(mode!=='missing-total')headers['content-range']=mode==='extra-total'?'0-0/2':'0-0/1';
 res.writeHead(mode==='unavailable'?503:200,headers);res.end(JSON.stringify(mode==='unavailable'?{message:'LOCAL_REPLAY_READ_UNAVAILABLE'}:rows));
 }catch(error){state.errors.push(error.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({message:'LOCAL_REPLAY_ASSERTION_FAILED'}));}});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54533,'127.0.0.1',resolve);});
 const client=createClient(intent.backend,'LOCAL_REPLAY_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 for(const value of ['valid','missing-total','extra-total','numeric-json','changed-count','unavailable']){
  mode=value;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  let response;try{response=await client.from('fnb_stocktake_lines').select(columns,{count:'exact'}).eq('club_id',club).eq('stocktake_id',session).limit(2).abortSignal(controller.signal);}finally{clearTimeout(timer);controller.abort();}
  const proof=response.error?{status:'unknown'}:resolveStocktakeOperationReceipt(intent,receipt.row,{rows:response.data,count:response.count});
  assert.equal(proof.status,value==='valid'?'found':'unknown');if(value==='valid'){assert.equal(response.count,1);assert.equal(typeof response.data[0].counted_qty,'string');}if(value==='missing-total')assert.equal(response.count,null);
  state.cases.push({mode:value,httpStatus:response.status,count:response.count,error:!!response.error,proof:proof.status});
 }
 assert.equal(state.errors.length,0);state.success=true;
}finally{if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}writeFileSync(output,JSON.stringify(state,null,2)+'\n');}
console.log(JSON.stringify({success:state.success,cases:state.cases,requests:state.requests.length,errors:state.errors.length,scope:state.kind}));
