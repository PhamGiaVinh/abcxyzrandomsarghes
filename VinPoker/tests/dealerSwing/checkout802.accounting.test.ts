import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {requiresStaleCheckoutCleanup} from '../../supabase/functions/_shared/checkoutSafety';

const attendance='00000000-0000-4000-8000-000000000001';
const club='00000000-0000-4000-8000-000000000002';
const actor='00000000-0000-4000-8000-000000000003';
const success={success:true,core_version:1,attendance_id:attendance,club_id:club,
 dealer_name:'LOCAL813 TEST',check_in_time:'2026-10-25T01:00:00Z',check_out_time:'2026-10-25T10:00:00Z',
 total_hours:8.5,released_pre_assigned:false,pre_assigned_table:null,
 replacement_table_id:null,replacement_session_id:null,replacement_assignment_id:null,
 released_assignment_ids:[],cleared_preassignment_assignment_ids:[],idempotent:false};

async function run(core:unknown=success,options:{error?:boolean;throws?:boolean;receipt?:unknown;receiptThrows?:boolean}={}){
 let checkout!:(admin:unknown,token:string,actor:string,id:string)=>Promise<Record<string,unknown>>;
 const writes:string[]=[];
 const rpc=vi.fn(async(name:string)=>{
  if(name==='operator_checkout_dealer_attendance_v1'){
   if(options.throws)throw Error('transport dropped');
   return {data:core,error:options.error?{message:'transport dropped'}:null};
  }
  if(name==='get_dealer_checkout_receipt_v1'){
   if(options.receiptThrows)throw Error('receipt unavailable');
   return {data:options.receipt??{status:'receipt_not_found'},error:null};
  }
  throw Error('Unexpected mutation RPC '+name);
 });
 const admin={rpc,from:(table:string)=>{
  const builder={select:()=>builder,eq:()=>builder,
   single:async()=>({data:table==='dealer_attendance'?{id:attendance,dealer_id:'dealer',status:'checked_in',check_in_time:new Date(Date.now()-9*3600000).toISOString()}
    :{id:'dealer',club_id:club,full_name:'LOCAL813 TEST',telegram_user_id:null,telegram_username:null},error:null}),
   insert:()=>{writes.push(table);throw Error('Legacy insert forbidden');},
   update:()=>{writes.push(table);throw Error('Legacy update forbidden');}};
  return builder;
 }};
 const source=readFileSync('supabase/functions/checkout-dealer/index.ts','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
 runInNewContext(ts.transpileModule(source+'\ncaptureCheckout(processOneCheckout);',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {captureCheckout:(fn:typeof checkout)=>{checkout=fn;},Deno:{serve:()=>{}},Date,console,requiresStaleCheckoutCleanup,mention:()=> 'LOCAL813 TEST'});
 const response=await checkout(admin,'',actor,attendance);
 return {response,rpc,writes};
}

describe('actual checkout Edge atomic boundary (modeled I/O; SQL accounting qualified natively)',()=>{
 it('uses the canonical transaction and never directly updates attendance/assignments/audit',async()=>{
  const {response,rpc,writes}=await run();
  expect(response).toMatchObject({success:true,attendance_id:attendance,total_hours:8.5});
  expect(rpc).toHaveBeenCalledExactlyOnceWith('operator_checkout_dealer_attendance_v1',{p_actor_id:actor,p_attendance_id:attendance});
  expect(writes).toEqual([]);
 });
 it.each([null,{},[],{...success,attendance_id:'other'},{...success,club_id:'other'},
  {...success,total_hours:-1},{...success,total_hours:NaN},{...success,idempotent:'true'},
  {...success,replacement_table_id:'table'},{...success,check_out_time:'invalid'}])(
  'does not accept an unverified transaction result %#',async(core)=>{
   const {response,writes}=await run(core);expect(response.success).toBe(false);expect(writes).toEqual([]);
  });
 it.each(['STALE_ATTENDANCE_REQUIRES_CLEANUP','LEGACY_CHECKOUT_REVIEW_REQUIRED'])(
  'preserves business rejection %s without legacy writes',async(code)=>{
   const {response,rpc,writes}=await run({success:false,attendance_id:attendance,code});
   expect(response).toMatchObject({success:false,code});expect(rpc).toHaveBeenCalledTimes(1);expect(writes).toEqual([]);
  });
 it.each([{error:true},{throws:true}])('recovers a lost response through the read-only receipt: %j',async(options)=>{
  const {response,rpc,writes}=await run(null,{...options,receipt:{status:'receipt_found',result:success}});
  expect(response).toMatchObject({success:true,idempotent:true,recovered:true,total_hours:8.5});
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(['operator_checkout_dealer_attendance_v1','get_dealer_checkout_receipt_v1']);
  expect(writes).toEqual([]);
 });
 it('does not replay a mutation when no receipt is confirmed',async()=>{
  const {response,rpc}=await run(null,{error:true});
  expect(response).toMatchObject({success:false,code:'CHECKOUT_OUTCOME_UNCONFIRMED'});
  expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('keeps receipt failure explicit without falling back to direct writes',async()=>{
  const {response,writes}=await run(null,{throws:true,receiptThrows:true});
  expect(response).toMatchObject({success:false,code:'CHECKOUT_OUTCOME_UNCONFIRMED'});expect(writes).toEqual([]);
 });
 it('returns saved replay without notifications, payroll writes, or a second assignment',async()=>{
  const {response,rpc,writes}=await run({...success,idempotent:true});
  expect(response).toMatchObject({success:true,idempotent:true});expect(rpc).toHaveBeenCalledTimes(1);expect(writes).toEqual([]);
 });
});
