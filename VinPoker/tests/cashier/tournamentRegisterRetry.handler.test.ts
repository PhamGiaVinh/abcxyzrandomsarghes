import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';

it.each(['pending','confirmed','read-error','quota-unavailable','quota-malformed','quota-available','quota-exhausted'])('keeps legacy retry and quota outcomes safe (%s)',async(status)=>{
 const tour='11111111-1111-4111-8111-111111111111',club='22222222-2222-4222-8222-222222222222';
 const quotaValid=status==='quota-available'||status==='quota-exhausted';
 const rpc=vi.fn(async()=>status==='quota-unavailable'?{data:null,error:{code:'PGRST202',message:'Function unavailable'}}:status==='quota-malformed'?{data:null,error:null}:{data:status!=='quota-exhausted',error:null});
 const writes=vi.fn();
 const existing={id:'old-registration',status,reference_code:'FROZEN_TEST',total_pay:110000,buy_in:100000,
  platform_fixed_fee:0,transfer_proof_image_url:null,transfer_proof_submitted:false,
  committed_at:'2026-10-19T01:00:00Z',used_free_rake:false};
 const admin={rpc,from:(table:string)=>{
  let columns='';
  const read=()=>{
   if(table==='tournaments')return {data:{id:tour,club_id:club,name:'TEST',buy_in:100000,rake_amount:20000,
    start_time:new Date(Date.now()+86400000).toISOString(),free_rake_enabled:true,free_rake_slots:10,free_rake_used:1},error:null};
   if(table==='cashier_tour_settings')return {data:{enabled:false},error:null};
   if(table==='platform_bank_accounts')return {data:columns==='bank_bin'?{bank_bin:'LOCAL_TEST'}
    :{id:'bank-test',bank_name:'TEST',account_number:'TEST_ONLY',account_holder:'TEST',qr_code_url:null},error:null};
   expect(table).toBe('tournament_registrations');
   return status==='read-error'?{data:null,error:{message:'TEST unavailable'}}:status.startsWith('quota-')?{data:null,error:null}:{data:existing,error:null};
  };
  const q={select:(value:string)=>{columns=value;return q;},eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>read(),insert:(value:unknown)=>{
    writes(table,value);if(!quotaValid)throw new Error('unexpected legacy retry write');
    if(table==='notifications')return {data:null,error:null};
    expect(table).toBe('tournament_registrations');
    return {select:()=>({single:async()=>({data:{id:'new-registration'},error:null})})};
   }};
  return q;
 }};
 let handler!:(req:Request)=>Promise<Response>;
 const source=readFileSync('supabase/functions/tournament-register/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:(_url:string,key:string)=>key==='LOCAL_SERVICE'?admin:{auth:{getUser:async()=>({data:{user:{id:'local-test-player'}},error:null})}},
  retryFetch:()=>{throw new Error('no external network');},
  z:{object:()=>({}),string:()=>({uuid:()=>({})})},parseBody:async()=>({ok:true,data:{tournament_id:tour}}),
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_ANON_KEY:'LOCAL_ANON',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_SERVICE'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
  Request,Response,Date,Math,console,
 });
 const response=await handler(new Request('http://local.invalid/tournament-register',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'}}));
 expect(response.status).toBe(status==='read-error'?500:status.startsWith('quota-')&&!quotaValid?503:200);
 const body=await response.json();
 if(status==='pending'||status==='confirmed')expect(body).toMatchObject({already_registered:true,registration_id:existing.id,total_pay:110000,reference_code:'FROZEN_TEST'});
 if(status.startsWith('quota-')&&!quotaValid)expect(body.error).toBe('Không xác minh được suất miễn rake. Vui lòng thử lại sau.');
 if(quotaValid){
  const total=status==='quota-available'?100000:120000;
  expect(body).toMatchObject({success:true,registration_id:'new-registration',total_pay:total,free_rake_applied:status==='quota-available'});
  expect(writes.mock.calls.filter(([table])=>table==='tournament_registrations')).toEqual([
   ['tournament_registrations',expect.objectContaining({buy_in:100000,total_pay:total,used_free_rake:status==='quota-available'})],
  ]);
  expect(writes.mock.calls.filter(([table])=>table==='notifications')).toHaveLength(1);
 }
 expect(rpc).toHaveBeenCalledTimes(status.startsWith('quota-')?1:0);
 expect(writes).toHaveBeenCalledTimes(quotaValid?2:0);
});
