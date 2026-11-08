import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';

async function run({gateData=undefined as unknown,throwClubs=false,clubsData=[{club_id:'TEST_CLUB',master_account_number:'TEST_ACCOUNT'}] as unknown,privacyFault='',providerStatus=200,badBuyin=false,badRetry=false,badUpdate=false,throwUpdate=false,unknown=false,throwBuyin=false,pending=false,throwRetry=false,badWorklist=false,missingWorklist=false,startPage=1,claimBusy=false,checkpointError=false,providerBody='{"data":[],"meta":{"pagination":{"total":0,"has_more":false}}}',providerPages=[] as string[],accountRows=[{id:'51100000-0000-4000-8000-000000000001',account_number:'TEST_ACCOUNT',active:true}]}={}) {
 let handler!:(req:Request)=>Promise<Response>;
 const sensitive='SYNTHETIC_BANK_TOKEN_DO_NOT_LOG';const errors=vi.fn();
 const updates:unknown[]=[];let providerCalls=0;const providerUrls:string[]=[];
 const rpc=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
  if(name==='sepay_get_active_payment_clubs'&&throwClubs)throw new Error(sensitive);
  if(name==='sepay_claim_pull_v2')return {data:claimBusy?{status:'busy'}:{status:'claimed',lease_token:'51100000-0000-4000-8000-000000000002',window_from:'2026-10-19T00:00:00Z',window_to:'2026-10-20T00:00:00Z',next_page:startPage},error:null};
  if(name==='sepay_checkpoint_pull_v2')return checkpointError?{data:null,error:{message:sensitive}}:{data:{ok:true,next_page:args?.p_next_page,complete:args?.p_complete},error:null};
  if(name==='sepay_get_active_payment_clubs')return privacyFault==='clubs'?{data:null,error:{message:sensitive}}:{data:clubsData,error:null};
  if(name==='sepay_get_club_api_token')return {data:'LOCAL_TEST_TOKEN',error:null};
  if(name==='sepay_ingest_verified_transactions')return {data:null,error:privacyFault==='ingest'?{message:sensitive}:null};
  if(name==='settle_bank_transaction')return {data:null,error:{message:sensitive}};
  if(name==='sepay_take_settlement_batch_v1')return privacyFault==='worklist'?{data:null,error:{message:sensitive}}:missingWorklist?{data:null,error:{message:'missing RPC'}}
   :{data:badWorklist?[{id:'first'},{id:'first'}]:[{id:'first'},{id:'second'}],error:null};
  if(name==='cashier_record_verified_bank_v1') {
   if(privacyFault==='buyin'&&args?.p_bank_transaction_id==='first')return {data:null,error:{message:sensitive}};
   if(throwBuyin&&args?.p_bank_transaction_id==='first')throw new Error('TEST unavailable');
   return args?.p_bank_transaction_id==='first'&&badBuyin
   ?{data:null,error:{message:'TEST failure'}}:{data:unknown?{handled:true,outcome:'surprise'}:{handled:true,outcome:'paid_seated'},error:null};
  }
  if(name==='cashier_retry_paid_seating_v1') {
   if(privacyFault==='retry')return {data:null,error:{message:sensitive}};
   if(throwRetry)throw new Error('TEST retry unavailable');
   return badRetry?{data:null,error:{message:'TEST retry failure'}}:{data:{ok:true,attempted:pending?1:0,seated:0,needs_review:pending?1:0},error:null};
  }
  throw new Error('unexpected RPC '+name);
 });
 const admin={rpc,from:(table:string)=>{
  let writing=false;const builder={select:()=>builder,eq:()=>builder,not:()=>builder,limit:()=>builder,
   update:(value:unknown)=>{updates.push(value);writing=true;return builder;},
   maybeSingle:async()=>({data:table==='cashier_tour_settings'?(gateData===undefined?{enabled:privacyFault!=='legacy'}:gateData):{last_pull_at:null},error:table==='cashier_tour_settings'&&privacyFault==='gate'?{message:sensitive}:null}),
   then:(resolve:(value:unknown)=>void,reject?:(error:unknown)=>void)=>Promise.resolve().then(()=>{
    if(writing&&throwUpdate)throw new Error('LOCAL872 observation transport unavailable');
    return writing?{data:null,error:badUpdate?{message:'TEST update failure'}:null}:{data:[{id:'first'},{id:'second'}],error:null};
   }).then(resolve,reject)};return builder;}};
 const source=readFileSync('supabase/functions/sepay-reconcile/index.ts','utf8')
  .replace(/import \{ createClient \} from "https:[^\n]+\n/,'').replace(/import \{ retryFetch \} from "[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,retryFetch:async(url:string)=>{providerUrls.push(url);if(privacyFault==='provider')throw new Error(sensitive);
   if(new URL(url).pathname==='/v2/bank-accounts')return new Response(JSON.stringify({data:accountRows,meta:{pagination:{has_more:false}}}),{status:providerStatus});
   return new Response(providerPages[providerCalls++]??providerBody,{status:providerStatus});},
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST_KEY',SEPAY_RECONCILE_SECRET:'LOCAL_TEST_SECRET',SEPAY_AUTO_CONFIRM:'true'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
  Request,Response,TextEncoder,crypto:webcrypto,console:{error:errors},Date,Uint8Array,
 });
 const response=await handler(new Request('http://local.invalid/reconcile',{method:'POST',headers:{'X-Reconcile-Secret':'LOCAL_TEST_SECRET'}}));
 return {status:response.status,body:await response.json(),updates,rpc,logs:errors.mock.calls,providerCalls,providerUrls};
}
describe('actual SePay reconcile handler outcomes (mock I/O)',()=>{
 it.each(['2026-02-30 10:00:00','2025-02-29 10:00:00','2026-04-31 10:00:00','2026-10-19 24:00:00','2026-10-19 10:60:00'])('does not normalize impossible provider datetime %s into a verified date',async(transaction_date)=>{
  const {rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_DATE_SHAPE',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001',transfer_type:'in',amount_in:1000,transaction_date}],meta:{pagination:{total:1,has_more:false}}})});
  const ingest=rpc.mock.calls.find(([name])=>name==='sepay_ingest_verified_transactions');
  expect(ingest).toBeDefined();
  expect((ingest![1]!.p_txns as {occurred_at:unknown}[])[0].occurred_at).toBeNull();
 });
 it.each([
  ['2024-02-29 00:00:00','2024-02-28T17:00:00.000Z'],
  ['2026-01-01 00:00:00','2025-12-31T17:00:00.000Z'],
  ['2026-10-19T23:59:59','2026-10-19T16:59:59.000Z'],
  ['2026-10-19 10:00:00.123','2026-10-19T03:00:00.123Z'],
 ])('preserves valid provider datetime %s in UTC+7',async(transaction_date,expected)=>{
  const {rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_VALID_DATE',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001',transfer_type:'in',amount_in:1000,transaction_date}],meta:{pagination:{total:1,has_more:false}}})});
  const ingest=rpc.mock.calls.find(([name])=>name==='sepay_ingest_verified_transactions');
  expect((ingest![1]!.p_txns as {occurred_at:unknown}[])[0].occurred_at).toBe(expected);
 });
 it.each([true,[],[1000],{},9007199254740992,'9007199254740993','0x10','0XFF','0b10','0o10'].map(amount=>({amount})))('does not coerce an invalid/unsafe provider amount into verified money: $amount',async({amount})=>{
  const {rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_AMOUNT_SHAPE',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001',transfer_type:'in',amount_in:amount,transaction_date:'2026-10-19 10:00:00'}],meta:{pagination:{total:1,has_more:false}}})});
  const ingest=rpc.mock.calls.find(([name])=>name==='sepay_ingest_verified_transactions');
  expect(ingest).toBeDefined();
  expect((ingest![1]!.p_txns as {amount:unknown}[])[0].amount).toBeNull();
 });
 it.each([[1000,1000],['1000.00',1000],['1000.6',1001],[' 1000.00 ',1000],['1e3',1000],[9007199254740991,9007199254740991]])('preserves existing safe VND rounding for %j',async(amount,expected)=>{
  const {rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_SAFE_AMOUNT',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001',transfer_type:'in',amount_in:amount}],meta:{pagination:{total:1,has_more:false}}})});
  const ingest=rpc.mock.calls.find(([name])=>name==='sepay_ingest_verified_transactions');
  expect((ingest![1]!.p_txns as {amount:unknown}[])[0].amount).toBe(expected);
 });
 it.each([{},[],{enabled:null},{enabled:'true'},{enabled:1}])('does not treat an unverified Cashier gate as disabled legacy mode: %j',async(gateData)=>{
  const {body,rpc,providerUrls}=await run({gateData});
  expect(body.ok).toBe(false);expect(body.results[0]).toMatchObject({status:'error',error:'cashier_gate_read_failed'});
  expect(providerUrls).toHaveLength(0);
  expect(rpc.mock.calls.some(([name])=>['sepay_get_club_api_token','sepay_claim_pull_v2','settle_bank_transaction','cashier_record_verified_bank_v1'].includes(name))).toBe(false);
 });
 it('preserves a genuinely absent gate as the existing legacy path, without assuming Cashier is enabled',async()=>{
  const {rpc}=await run({gateData:null});
  expect(rpc.mock.calls.some(([name])=>name==='cashier_record_verified_bank_v1')).toBe(false);
  expect(rpc.mock.calls.some(([name])=>name==='settle_bank_transaction')).toBe(true);
 });
 it('returns a sanitized failure for a rejected active-clubs transport without running provider or writes',async()=>{
  const {status,body,rpc,providerUrls,updates,logs}=await run({throwClubs:true});
  expect(status).toBe(500);expect(body).toEqual({ok:false,error:'clubs_query_failed'});
  expect(providerUrls).toHaveLength(0);expect(updates).toHaveLength(0);expect(rpc).toHaveBeenCalledTimes(1);
  expect(JSON.stringify({body,logs})).not.toContain('SYNTHETIC_BANK_TOKEN_DO_NOT_LOG');
 });
 it.each([null,{},'invalid',[null],[{club_id:'',master_account_number:'TEST_ACCOUNT'}],
  [{club_id:'TEST_CLUB',master_account_number:{private:'SYNTHETIC_BANK_TOKEN_DO_NOT_LOG'}}],
  [{club_id:'TEST_CLUB',master_account_number:'TEST_ACCOUNT'},{club_id:'TEST_CLUB',master_account_number:'TEST_ACCOUNT'}]])(
  'does not report healthy or fetch accounts when active-club data is malformed: %j',async(clubsData)=>{
   const {status,body,rpc,providerUrls,logs}=await run({clubsData});expect(status).toBe(503);
   expect(body).toMatchObject({ok:false,error:'clubs_query_unverified'});
   expect(providerUrls).toHaveLength(0);
   expect(rpc.mock.calls.some(([name])=>name==='sepay_get_club_api_token'||name==='sepay_claim_pull_v2'||name==='cashier_record_verified_bank_v1')).toBe(false);
   expect(JSON.stringify({body,logs})).not.toContain('SYNTHETIC_BANK_TOKEN_DO_NOT_LOG');
  });
 it('accepts an explicitly empty active-club list and still invokes canonical paid-seat retry',async()=>{
  const {body,rpc,providerUrls}=await run({clubsData:[]});expect(body).toMatchObject({ok:true,clubs:0,results:[]});
  expect(providerUrls).toHaveLength(0);expect(rpc.mock.calls.some(([name])=>name==='cashier_retry_paid_seating_v1')).toBe(true);
 });
 it('does not ingest a torn batch when the provider total changes between pages',async()=>{
  const row={id:'TEST_TXN',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001'};
  const {body,rpc}=await run({providerPages:[
   JSON.stringify({data:[row],meta:{pagination:{total:100,has_more:true}}}),
   JSON.stringify({data:[row],meta:{pagination:{total:101,has_more:false}}}),
  ]});
  expect(body.results[0].error).toBe('sepay_api_window_changed');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_ingest_verified_transactions'||name==='sepay_checkpoint_pull_v2')).toBe(false);
 });
 it.each([-1,1.5,'3',null])('rejects an invalid provider total %s',async(total)=>{
  const {body,rpc}=await run({providerBody:JSON.stringify({data:[],meta:{pagination:{total,has_more:false}}})});
  expect(body.results[0].error).toBe('sepay_api_invalid_pagination');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_checkpoint_pull_v2')).toBe(false);
 });
 it('resumes the claimed page and fixed UTC+7 window, not the current clock',async()=>{
  const {providerUrls,rpc}=await run({startPage:6});
  const url=providerUrls.map(url=>new URL(url)).find(url=>url.pathname==='/v2/transactions')!;
  expect(url.searchParams.get('page')).toBe('6');
  expect(url.searchParams.get('transaction_date_from')).toBe('2026-10-19 07:00:00');
  expect(url.searchParams.get('transaction_date_to')).toBe('2026-10-20 07:00:00');
  expect(rpc).toHaveBeenCalledWith('sepay_checkpoint_pull_v2',expect.objectContaining({p_expected_page:6,p_next_page:7,p_complete:true,p_provider_total:0}));
 });
 it('does not fetch transactions or settle while another pull owns the lease',async()=>{
  const {body,rpc,providerCalls}=await run({claimBusy:true});
  expect(body.ok).toBe(false);expect(body.results[0]).toMatchObject({status:'pending',pull_status:'busy'});
  expect(providerCalls).toBe(0);expect(rpc.mock.calls.some(([name])=>name==='sepay_take_settlement_batch_v1')).toBe(false);
  expect(rpc.mock.calls.some(([name])=>name==='cashier_retry_paid_seating_v1')).toBe(true);
 });
 it('retains an unverified checkpoint as an error and never writes a client-side watermark',async()=>{
  const {body,updates,rpc}=await run({checkpointError:true});
  expect(body.ok).toBe(false);expect(body.results[0].error).toBe('sepay_pull_checkpoint_unverified');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_take_settlement_batch_v1')).toBe(false);
  expect(updates).not.toEqual(expect.arrayContaining([expect.objectContaining({last_pull_at:expect.anything()})]));
 });
 it('requires trustworthy pagination metadata before checkpointing',async()=>{
  const {body,rpc}=await run({providerBody:'{"data":[]}'});
  expect(body.results[0].error).toBe('sepay_api_invalid_pagination');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_checkpoint_pull_v2')).toBe(false);
 });
 it('resolves the exact active account UUID before requesting scoped transactions',async()=>{
  const {providerUrls}=await run();const transactions=providerUrls.map(url=>new URL(url)).find(url=>url.pathname==='/v2/transactions')!;
  expect(new URL(providerUrls[0]).pathname).toBe('/v2/bank-accounts');
  expect(transactions.searchParams.get('bank_account_id')).toBe('51100000-0000-4000-8000-000000000001');
  expect(transactions.searchParams.has('account_number')).toBe(false);
 });
 it('rejects an ambiguous account number rather than choosing the first bank',async()=>{
  const {body,rpc}=await run({accountRows:[
   {id:'51100000-0000-4000-8000-000000000001',account_number:'TEST_ACCOUNT',active:true},
   {id:'51100000-0000-4000-8000-000000000002',account_number:'TEST_ACCOUNT',active:true},
  ]});
  expect(body.ok).toBe(false);expect(body.results[0].error).toBe('sepay_account_multiple_matches');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_ingest_verified_transactions')).toBe(false);
 });
 it.each([
  {accountRows:[{id:'51100000-0000-4000-8000-000000000001',account_number:'TEST_ACCOUNT',active:false}]},
  {accountRows:[{id:'51100000-0000-4000-8000-000000000001',account_number:'PREFIX_TEST_ACCOUNT',active:true}]},
  {accountRows:[]},
 ])('does not use an inactive, inexact search match or absent account',async({accountRows})=>{
  const {body,providerUrls}=await run({accountRows});
  expect(body.ok).toBe(false);expect(body.results[0].error).toBe('sepay_account_not_found');
  expect(providerUrls.some(url=>new URL(url).pathname==='/v2/transactions')).toBe(false);
 });
 it('rejects an invalid provider bank UUID',async()=>{
  const {body}=await run({accountRows:[{id:'NOT_A_UUID',account_number:'TEST_ACCOUNT',active:true}]});
  expect(body.results[0].error).toBe('sepay_account_payload_invalid');
 });
 it.each([
  {account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000002'},
  {account_number:'FOREIGN_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001'},
  {account_number:'TEST_ACCOUNT'},
 ])('requires both transaction account number and bank UUID to match',async(row)=>{
  const {body,rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_TXN',...row}]})});
  expect(body.results[0].error).toBe('sepay_transaction_account_mismatch');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_ingest_verified_transactions')).toBe(false);
 });
 it('rejects transactions from a different account before ingestion',async()=>{
  const {body,rpc}=await run({providerBody:JSON.stringify({data:[{id:'TEST_TXN',account_number:'FOREIGN_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000002'}]})});
  expect(body.ok).toBe(false);expect(body.results[0].error).toBe('sepay_transaction_account_mismatch');
  expect(rpc.mock.calls.some(([name])=>name==='sepay_ingest_verified_transactions')).toBe(false);
 });
 it('requests the documented SePay v2 page size rather than an ignored limit parameter',async()=>{
  const {providerUrls}=await run();const url=new URL(providerUrls[0]);
  expect(url.searchParams.get('per_page')).toBe('100');
  expect(url.searchParams.has('limit')).toBe(false);
 });
 it('checkpoints the next page without advancing the completed watermark at the per-tick cap',async()=>{
  const {body,updates,rpc,providerCalls}=await run({providerBody:JSON.stringify({data:[{id:'TEST_TXN',account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001'}],meta:{pagination:{total:6,has_more:true}}})});
  expect(body.ok).toBe(false);
  expect(body.results[0]).toMatchObject({status:'pending',pull_status:'pending',pull_next_page:6});
  expect(rpc).toHaveBeenCalledWith('sepay_checkpoint_pull_v2',expect.objectContaining({p_expected_page:1,p_next_page:6,p_complete:false}));
  expect(updates).not.toEqual(expect.arrayContaining([expect.objectContaining({last_pull_at:expect.any(String)})]));
  expect(rpc.mock.calls.some(([name])=>name==='cashier_retry_paid_seating_v1')).toBe(true);
  expect(providerCalls).toBe(5);
 });
 it('accepts a complete pull whose final page is exactly the cap',async()=>{
  const providerPages=Array.from({length:5},(_,i)=>JSON.stringify({data:[{id:'TEST_TXN_'+i,account_number:'TEST_ACCOUNT',bank_account_id:'51100000-0000-4000-8000-000000000001'}],
   meta:{pagination:{total:5,has_more:i<4,current_page:i+1,last_page:5}}}));
  const {body,updates,providerCalls,rpc}=await run({providerPages});
  expect(body.ok).toBe(true);expect(providerCalls).toBe(5);
  expect(updates).toEqual(expect.arrayContaining([expect.objectContaining({last_pull_status:'ok'})]));
  expect(rpc).toHaveBeenCalledWith('sepay_checkpoint_pull_v2',expect.objectContaining({p_expected_page:1,p_next_page:6,p_complete:true}));
  expect(rpc).toHaveBeenCalledWith('sepay_ingest_verified_transactions',expect.objectContaining({p_txns:expect.arrayContaining([
   expect.objectContaining({provider_txn_id:'TEST_TXN_4'})])}));
 });
 it.each(['clubs','gate','worklist','buyin','retry','provider','ingest','legacy'])('keeps %s private diagnostics out of logs/state/response',async privacyFault=>{
  const result=await run({privacyFault,...(privacyFault==='ingest'?{providerBody:'{"data":[{"id":"TEST_TXN","account_number":"TEST_ACCOUNT","bank_account_id":"51100000-0000-4000-8000-000000000001"}],"meta":{"pagination":{"total":1,"has_more":false}}}'}:{})});
  expect(result.body.ok).toBe(false);
  expect(JSON.stringify({body:result.body,updates:result.updates,logs:result.logs})).not.toContain('SYNTHETIC_BANK_TOKEN_DO_NOT_LOG');
  expect(result.logs.length).toBeGreaterThan(0);
 });
 it('preserves safe HTTP operation codes without echoing the provider body',async()=>{
  const result=await run({providerStatus:401,providerBody:'SYNTHETIC_BANK_TOKEN_DO_NOT_LOG'});
  expect(result.body.results[0]).toMatchObject({status:'error',error:'sepay_api_401'});
  expect(result.updates[0]).toMatchObject({last_pull_error:'sepay_api_401'});
  expect(JSON.stringify(result.logs)).not.toContain('SYNTHETIC_BANK_TOKEN_DO_NOT_LOG');
 });
 for(const options of [{badWorklist:true},{missingWorklist:true}])it('fails closed on invalid/missing fair batch contract',async()=>{
  const {body,rpc}=await run(options);expect(body.ok).toBe(false);expect(body.results[0].status).toBe('error');
  expect(rpc.mock.calls.some(([name])=>name==='cashier_record_verified_bank_v1')).toBe(false);
 });
 for(const providerBody of ['broken-json','null','{}','{"data":{}}']) {
  it('does not report malformed provider data as an empty successful pull: '+providerBody,async()=>{
   const {body,updates,rpc}=await run({providerBody});
   expect(body.ok).toBe(false);expect(body.results[0].status).toBe('error');
   expect(updates[0]).toMatchObject({last_pull_status:'error'});
   expect(rpc.mock.calls.some(([name])=>name==='cashier_record_verified_bank_v1')).toBe(false);
   expect(rpc.mock.calls.some(([name])=>name==='cashier_retry_paid_seating_v1')).toBe(true);
  });
 }
 it('keeps a fully successful pull and settlement successful',async()=>{
  const {body}=await run();expect(body.ok).toBe(true);expect(body.settled).toBe(2);
  expect(body.results[0]).toMatchObject({attempted:2,succeeded:2,failed:0,business_pending:0,status:'ok'});
 });
 it('continues after a rejected per-row request',async()=>{
  const {body}=await run({throwBuyin:true});expect(body.ok).toBe(false);expect(body.settled).toBe(1);
  expect(body.results[0]).toMatchObject({failed:1,attempted:2});
 });
 it('reports rejected paid-seat retry as an explicit error response',async()=>{
  expect((await run({throwRetry:true})).body.paid_seating_retry).toBe('error');
 });
 it('continues good rows but reports settlement failure instead of pull ok',async()=>{
  const {body,updates}=await run({badBuyin:true});
  expect(body.ok).toBe(false);expect(body.settled).toBe(1);
  expect(body.results[0]).toMatchObject({status:'partial',attempted:2,failed:1,pull_status:'ok'});
  expect(updates[0]).toMatchObject({last_pull_status:'error'});
 });
 it('does not return ok when paid seating retry fails',async()=>{expect((await run({badRetry:true})).body.ok).toBe(false);});
 it('does not silently count unknown handled outcomes as successful',async()=>{
  expect((await run({unknown:true})).body.results[0]).toMatchObject({failed:2,status:'partial'});
 });
 it.each([{options:{},succeeded:2,failed:0},{options:{badBuyin:true},succeeded:1,failed:1},{options:{unknown:true},succeeded:0,failed:2}])('retains completed batch summary when observability transport rejects: $succeeded/$failed',async({options,succeeded,failed})=>{
  const {body,rpc,updates}=await run({...options,throwUpdate:true});
  expect(body.ok).toBe(false);expect(body.settled).toBe(succeeded);
  expect(body.results[0]).toMatchObject({attempted:2,succeeded,failed,settled:succeeded,pull_status:'ok',observation_status:'error',status:'partial'});
  expect(body.results[0].error).toBeUndefined();
  expect(rpc.mock.calls.filter(([name])=>name==='cashier_record_verified_bank_v1')).toHaveLength(2);
  expect(updates).toHaveLength(1);
  expect(rpc.mock.calls.filter(([name])=>name==='cashier_retry_paid_seating_v1')).toHaveLength(1);
 });
 it('reports observability write failure',async()=>{expect((await run({badUpdate:true})).body.ok).toBe(false);});
});
