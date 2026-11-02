import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

describe('actual mass-assign notification audit lifecycle (modeled I/O, no delivery)',()=>{
 it.each([{background:true,reject:false},{background:false,reject:false},{background:true,reject:true},{background:false,reject:true}])(
 'retains the lazy failure audit through completion (background=$background reject=$reject)',async({background,reject})=>{
  let handler!:(req:Request)=>Promise<Response>;let auditExecuted=false;let releaseAudit!:()=>void;
  const auditGate=new Promise<void>(resolve=>{releaseAudit=resolve;});
  let auditStarted!:()=>void;const started=new Promise<void>(resolve=>{auditStarted=resolve;});
  const warn=vi.fn();
  const waits:Promise<unknown>[]=[];
  const admin={rpc:async()=>({data:true,error:null}),from:(table:string)=>{
   const b={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:{swing_duration_minutes:45},error:null}),
    insert:()=>({then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>{
     if(table==='swing_audit_logs'){auditExecuted=true;auditStarted();return auditGate.then(()=>{if(rejectAudit)throw Error('LOCAL806_PRIVATE_FAULT');return {data:null,error:null};}).then(resolve,reject);}
     return Promise.resolve({data:null,error:null}).then(resolve,reject);
    }})};return b;
  }};
  const rejectAudit=reject;
  const source=readFileSync('supabase/functions/mass-assign/index.ts','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   Deno:{serve:(fn:typeof handler)=>{handler=fn;},env:{get:()=> 'LOCAL_TEST_ONLY'}},createClient:()=>admin,
   authenticateUser:async()=>({uid:'LOCAL_ACTOR'}),manualDealerIntentHeaders:()=>({}),
   computeSwingDuration:async()=>({durationMinutes:45,durationRationale:'TEST',isDynamic:false}),
   fillOpenOperation:async()=>({assignments:[{table_id:'LOCAL_TABLE',table_name:'LOCAL806 TEST',full_name:'TEST DEALER'}],requested:1,assigned:1,remaining:0}),
   getClubTelegramChatId:async()=> 'LOCAL_SINK',formatMassAssignMessage:()=> 'LOCAL806 TEST',
   sendTelegramNotification:async(_token:string,_chat:string,_message:string,options?:{logError:(message:string)=>void})=>{await Promise.resolve();options?.logError('LOCAL806_DELIVERY_FAILED');return false;},
   jsonResponse:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),Request,Response,console:{log:vi.fn(),warn},
   EdgeRuntime:background?{waitUntil:(promise:Promise<unknown>)=>{waits.push(promise);}}:undefined,
  });
  const responsePromise=handler(new Request('http://local.invalid/mass-assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({club_id:'LOCAL_CLUB',operation_id:'e8060000-0000-4000-8000-000000000001'})}));
  // Fail deterministically if the lazy audit was never consumed, without
  // hanging on the start signal at a regressed source version.
  for(let n=0;n<32;n++)await Promise.resolve();
  expect(auditExecuted).toBe(true);
  await started;
  expect(waits).toHaveLength(background?1:0);
  let settled=false;void (background?waits[0]:responsePromise).then(()=>{settled=true;});for(let n=0;n<8;n++)await Promise.resolve();
  expect(settled).toBe(false);releaseAudit();if(background)await waits[0];
  const response=await responsePromise;expect(response.status).toBe(200);expect((await response.json()).assigned).toBe(1);
  expect(warn).toHaveBeenCalledTimes(reject?1:0);expect(JSON.stringify(warn.mock.calls)).not.toContain('LOCAL806_PRIVATE_FAULT');
 });
});
