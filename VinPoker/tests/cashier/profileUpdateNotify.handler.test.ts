import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {describe,expect,it,vi} from 'vitest';
import {constantTimeEqual} from '../../supabase/functions/_shared/internal-trigger-auth';

const user='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const valid={record:{id:'33333333-3333-4333-8333-333333333333',user_id:user,club_id:'44444444-4444-4444-8444-444444444444',
 changed_fields:['display_name'],old_values:{display_name:'Before TEST'},new_values:{display_name:'After TEST'}}};
async function run({authorization='Bearer LOCAL_INTERNAL',configured=true,method='POST',body:input=valid,insertError=false,throws=false,readErrorTable}:
 {authorization?:string;configured?:boolean;method?:string;body?:unknown;insertError?:boolean;throws?:boolean;readErrorTable?:string}={}){
 let handler!:(request:Request)=>Promise<Response>;
 const writes=vi.fn(async(_rows:unknown)=>({error:insertError?{message:'SYNTHETIC_PRIVATE_DB_DETAIL'}:null}));
 const from=vi.fn((table:string)=>{
  if(throws)throw new Error('SYNTHETIC_PRIVATE_DB_DETAIL');
  const query:Record<string,unknown>={insert:writes,select:()=>query,eq:()=>query,
   maybeSingle:async()=>({data:table===readErrorTable?null:table==='profiles'?{display_name:'After TEST'}:{owner_id:owner},error:table===readErrorTable?{message:'SYNTHETIC_PRIVATE_DB_DETAIL'}:null}),
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table===readErrorTable?null:[],error:table===readErrorTable?{message:'SYNTHETIC_PRIVATE_DB_DETAIL'}:null}).then(resolve)};
  return query;
 });
 const createClient=vi.fn(()=>({from})),fetch=vi.fn(async()=>new Response('{}',{status:200})),logs=vi.fn();
 const source=readFileSync('supabase/functions/profile-update-notify/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  z,constantTimeEqual,createClient,Request,Response,fetch,console:{error:logs},
  parseBody:async(request:Request,schema:z.ZodTypeAny)=>{
   const result=schema.safeParse(await request.json().catch(()=>null));
   return result.success?{ok:true,data:result.data}:{ok:false,response:new Response('{"error":"invalid_payload"}',{status:400})};
  },
  Deno:{env:{get:(name:string)=>({SUPABASE_SERVICE_ROLE_KEY:configured?'LOCAL_INTERNAL':undefined,SUPABASE_URL:'http://local.invalid'})[name]},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const request=new Request('http://local.invalid/profile-update-notify',{method,headers:{authorization,'content-type':'application/json'},
  ...(method==='GET'||method==='OPTIONS'?{}:{body:JSON.stringify(input)})});
 const response=await handler(request);
 return {status:response.status,body:await response.json().catch(()=>null),createClient,writes,fetch,logs};
}

describe('actual profile notification handler internal boundary (no external delivery)',()=>{
 it.each(['','Bearer ordinary-user-jwt','Bearer wrong-internal'])('denies %j before privileged reads or writes',async(authorization)=>{
  const result=await run({authorization});expect(result.status).toBe(401);
  expect(result.createClient).not.toHaveBeenCalled();expect(result.writes).not.toHaveBeenCalled();expect(result.fetch).not.toHaveBeenCalled();
 });
 it('fails closed when service authentication is not configured',async()=>{
  const result=await run({configured:false});expect(result.status).toBe(503);expect(result.createClient).not.toHaveBeenCalled();
 });
 it('rejects unsupported method before privileged work',async()=>{
  const result=await run({method:'GET'});expect(result.status).toBe(405);expect(result.createClient).not.toHaveBeenCalled();
 });
 it.each([null,{record:{...valid.record,changed_fields:'display_name'}},{record:{...valid.record,user_id:'not-an-id'}},
  {record:{...valid.record,changed_fields:['untrusted_label']}},{record:{...valid.record,old_values:null}}])('validates an internal payload before constructing the service client: %j',async(body)=>{
  const result=await run({body});expect(result.status).toBe(400);expect(result.createClient).not.toHaveBeenCalled();
 });
 it('does not acknowledge notification persistence failure or expose DB diagnostics',async()=>{
  const result=await run({insertError:true});expect(result.status).toBeGreaterThanOrEqual(500);expect(result.body.ok).not.toBe(true);
  expect(JSON.stringify({body:result.body,logs:result.logs.mock.calls})).not.toContain('SYNTHETIC_PRIVATE_DB_DETAIL');expect(result.fetch).not.toHaveBeenCalled();
 });
 it.each(['profiles','club_cashiers','clubs','user_roles'])('does not turn %s read failure into successful or partial notification delivery',async(readErrorTable)=>{
  const body=readErrorTable==='user_roles'?{record:{...valid.record,club_id:null}}:valid;
  const result=await run({body,readErrorTable});expect(result.status).toBeGreaterThanOrEqual(500);expect(result.body.ok).not.toBe(true);
  expect(result.writes).not.toHaveBeenCalled();expect(result.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify({body:result.body,logs:result.logs.mock.calls})).not.toContain('SYNTHETIC_PRIVATE_DB_DETAIL');
 });
 it('does not return raw privileged errors',async()=>{
  const result=await run({throws:true});expect(result.status).toBeGreaterThanOrEqual(500);
  expect(JSON.stringify({body:result.body,logs:result.logs.mock.calls})).not.toContain('SYNTHETIC_PRIVATE_DB_DETAIL');
 });
 it('retains the authorized TEST notification path and excludes the changed user',async()=>{
  const result=await run();expect(result.status).toBe(200);expect(result.body.ok).toBe(true);expect(result.writes).toHaveBeenCalledOnce();
  const rows=result.writes.mock.calls[0]?.[0] as unknown as Array<{user_id:string}>;
  expect(rows.map(row=>row.user_id)).toEqual([owner]);expect(rows.some(row=>row.user_id===user)).toBe(false);
 });
 it('leaves push delivery to the notification outbox instead of dispatching a second untracked request',async()=>{
  const result=await run();expect(result.status).toBe(200);expect(result.writes).toHaveBeenCalledOnce();
  expect(result.fetch).not.toHaveBeenCalled();
 });
});
