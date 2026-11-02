import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

describe('actual webhook audit observability (modeled transport)',()=>{
 it('returns ingest failure without logging private database error details',async()=>{
  let handler!:(req:Request)=>Promise<Response>;
  const error=vi.fn(),sensitive='LOCAL_TEST_PRIVATE_ACCOUNT_AND_REFERENCE';
  const source=readFileSync('supabase/functions/sepay-webhook/index.ts','utf8').replace(/import \{ createClient \} from "https:[^\n]+\n/,'');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   createClient:()=>({from:()=>({upsert:()=>({select:async()=>({data:null,error:{message:sensitive}})})})}),
   Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_WEBHOOK_SECRET:'LOCAL_TEST'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
   Request,Response,URL,TextEncoder,crypto:webcrypto,Uint8Array,Date,console:{error},
  });
  const result=await handler(new Request('http://local.invalid/functions/v1/sepay-webhook/TEST',{method:'POST',
   headers:{Authorization:'Apikey LOCAL_TEST'},body:JSON.stringify({id:'LOCAL_TEST_TRANSACTION',accountNumber:'LOCAL_TEST_ACCOUNT',transferAmount:1,transferType:'in',transactionDate:'2026-10-21 12:00:00'})}));
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({success:false,error:'ingest failed'});
  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls.flat().join(' ')).not.toContain(sensitive);
 });
 for(const thrown of [false,true])for(const authorized of [false,true])it(`keeps outcome on audit failure without leaking details; thrown=${thrown}, authorized=${authorized}`,async()=>{
  let handler!:(req:Request)=>Promise<Response>;
  const error=vi.fn();const sensitive='LOCAL_TEST_PRIVATE_ACCOUNT_AND_TOKEN';let inserts=0;
  const source=readFileSync('supabase/functions/sepay-webhook/index.ts','utf8').replace(/import \{ createClient \} from "https:[^\n]+\n/,'');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   createClient:()=>({from:(table:string)=>{
    if(table==='bank_transactions')return {upsert:()=>{inserts++;return{select:async()=>({data:[{id:'LOCAL_TEST_BANK_ID'}],error:null})};}};
    expect(table).toBe('bank_webhook_audit');
    return {insert:async()=>{if(thrown)throw new Error(sensitive);return{error:{message:sensitive}};}};
   }}),Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_WEBHOOK_SECRET:'LOCAL_TEST'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
   Request,Response,URL,TextEncoder,crypto:webcrypto,Uint8Array,Date,console:{error},
  });
  const result=await handler(new Request('http://local.invalid/functions/v1/sepay-webhook/TEST',{method:'POST',
   headers:{Authorization:authorized?'Apikey LOCAL_TEST':'Apikey WRONG_TEST'},
   body:JSON.stringify({id:'LOCAL_TEST_TRANSACTION',accountNumber:'LOCAL_TEST_ACCOUNT',transferAmount:1,transferType:'in',transactionDate:'2026-10-19 12:00:00'})}));
  expect(result.status).toBe(authorized?200:401);expect(inserts).toBe(authorized?1:0);expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls.flat().join(' ')).not.toContain(sensitive);
 });
});

async function mapWebhookAmount(amount:unknown,transactionDate='2026-10-28 12:00:00'){
 let handler!:(req:Request)=>Promise<Response>;let saved:Record<string,unknown>|undefined;
 const source=readFileSync('supabase/functions/sepay-webhook/index.ts','utf8').replace(/import \{ createClient \} from "https:[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>({from:(table:string)=>table==='bank_transactions'?{upsert:(row:Record<string,unknown>)=>{saved=row;return {select:async()=>({data:[{id:'LOCAL1226_BANK_ID'}],error:null})};}}:{insert:async()=>({error:null})}}),
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_WEBHOOK_SECRET:'LOCAL_TEST'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
  Request,Response,URL,TextEncoder,crypto:webcrypto,Uint8Array,Date,console:{error:vi.fn()},
 });
 const response=await handler(new Request('http://local.invalid/functions/v1/sepay-webhook/TEST',{method:'POST',headers:{Authorization:'Apikey LOCAL_TEST'},body:JSON.stringify({id:'LOCAL1226_TRANSACTION',accountNumber:'LOCAL1226_ACCOUNT',transferAmount:amount,transferType:'in',transactionDate})}));
 return {status:response.status,body:await response.json(),saved};
}

describe('webhook amount mapping',()=>{
 it.each(['0x10','0XFF','0b10','0o10','  ',[],[1000],9007199254740992,'9007199254740993'])('keeps unsupported or unsafe money unknown and quarantined: %j',async(amount)=>{
  const result=await mapWebhookAmount(amount);expect(result.status).toBe(200);expect(result.body).toEqual({success:true});expect(result.saved?.amount).toBeNull();expect(result.saved?.status).toBe('quarantined');
 });
 it.each([[1000,1000],['1000.6',1001],[' 1000.00 ',1000],['1e3',1000],[9007199254740991,9007199254740991]])('retains valid amount conversion and rounding: %j',async(amount,expected)=>{
  const result=await mapWebhookAmount(amount);expect(result.saved?.amount).toBe(expected);expect(result.saved?.status).toBe('unmatched');
 });
});

describe('webhook date mapping',()=>{
 it.each(['2026-02-30 10:00:00','2025-02-29 10:00:00','2026-04-31 10:00:00','2026-10-28 24:00:00','2026-10-28 10:60:00'])('quarantines impossible calendar datetime %s without inventing an occurred date',async(date)=>{
  const result=await mapWebhookAmount(1000,date);expect(result.status).toBe(200);expect(result.body).toEqual({success:true});expect(result.saved?.occurred_at).toBeNull();expect(result.saved?.status).toBe('quarantined');expect(result.saved?.amount).toBe(1000);
 });
 it.each([
  ['2024-02-29 00:00:00','2024-02-28T17:00:00.000Z'],
  ['2026-01-01 00:00:00','2025-12-31T17:00:00.000Z'],
  ['2026-10-28T23:59:59','2026-10-28T16:59:59.000Z'],
  ['2026-10-28 10:00:00.123','2026-10-28T03:00:00.123Z'],
 ])('preserves valid UTC+7 calendar datetime %s',async(date,expected)=>{
  const result=await mapWebhookAmount(1000,date);expect(result.saved?.occurred_at).toBe(expected);expect(result.saved?.status).toBe('unmatched');
 });
});
