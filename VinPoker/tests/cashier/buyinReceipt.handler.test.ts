import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it} from 'vitest';
import {canReadBuyinReceipt} from '../../supabase/functions/get-buyin-receipt/access';

const actor='11111111-1111-4111-8111-111111111111',reg='22222222-2222-4222-8222-222222222222';
async function run(total:unknown,stack:unknown,seatReceipt:unknown=null,expectedStatus=200,authFailure:unknown=null){
 let handler!:(req:Request)=>Promise<Response>;
 const rows:Record<string,unknown>={
  tournament_registrations:{id:reg,tournament_id:'tour',club_id:'club',player_id:actor,total_pay:total,status:'pending'},
  tournaments:{id:'tour',club_id:'club',name:'TEST',starting_stack:stack},seat_draw_receipts:seatReceipt,
  clubs:{name:'TEST'},club_members:null,profiles:null,cashier_refund_requests:null,cashier_buyin_movements:[{applied_amount:50}],
 };
 let adminReads=0;
 const admin={from:(table:string)=>{
  adminReads++;
  const q:Record<string,unknown>={};
  for(const method of ['select','eq','is','order','limit'])q[method]=()=>q;
  q.maybeSingle=()=>Promise.resolve({data:rows[table],error:null});
  q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve);
  return q;
 }};
 const source=readFileSync('supabase/functions/get-buyin-receipt/index.ts','utf8').replace(/import\s+[\s\S]*?from\s+"[^"]+";/g,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:(_url:string,key:string)=>key==='ANON'?{auth:{getUser:async()=>{
    if(authFailure instanceof Error)throw authFailure;
    return {data:{user:{id:actor}},error:authFailure};
  }}}:admin,
  z,canReadBuyinReceipt,retryFetch:()=>{throw Error('external fetch forbidden');},
  handleOptions:()=>null,corsHeaders:()=>({}),jsonResp:(_req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  parseBody:async(req:Request,schema:z.ZodTypeAny)=>{const result=schema.safeParse(await req.json());return result.success?{ok:true,data:result.data}:{ok:false,response:new Response('',{status:400})};},
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_ANON_KEY:'ANON',SUPABASE_SERVICE_ROLE_KEY:'SERVICE'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},console,
 });
 const response=await handler(new Request('http://local.invalid/receipt',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'},body:JSON.stringify({registration_id:reg})}));
 expect(response.status).toBe(expectedStatus);if(authFailure)expect(adminReads).toBe(0);return await response.json();
}
it.each([null,'',false])('does not turn missing receipt numbers into zero or infer fully paid (%j)',async value=>{
 const {receipt}=await run(value,value);
 expect(receipt.total_pay).toBeNull();expect(receipt.starting_stack).toBeNull();
 expect(receipt.received_amount).toBe(50);expect(receipt.remaining_amount).toBeNull();expect(receipt.payment_state).toBe('unverified');
});
it('retains valid numeric strings and computes the existing partial payment state',async()=>{
 const {receipt}=await run('100','30000');
 expect(receipt.total_pay).toBe(100);expect(receipt.starting_stack).toBe(30000);
 expect(receipt.remaining_amount).toBe(50);expect(receipt.payment_state).toBe('partial');
});
it('preserves an explicit numeric zero rather than treating it as missing',async()=>{
 const {receipt}=await run(0,0);expect(receipt.total_pay).toBe(0);expect(receipt.starting_stack).toBe(0);
});
it('preserves the canonical QR when the secondary receipt matches registration, tournament and player',async()=>{
 const {receipt}=await run(100,30000,{registration_id:reg,tournament_id:'tour',player_id:actor,receipt_code:'LOCAL-QR',display_name:'LOCAL TEST',status:'issued',table_number:7,seat_number:3});
 expect(receipt.qr_value).toBe('LOCAL-QR');expect(receipt.table_number).toBe(7);expect(receipt.seat_number).toBe(3);
});
it.each(['player_id','tournament_id','registration_id'])('does not expose a secondary seat receipt with a mismatched %s',async(field)=>{
 const packet={registration_id:reg,tournament_id:'tour',player_id:actor,receipt_code:'PRIVATE-OTHER-QR',display_name:'PRIVATE OTHER',status:'issued',[field]:'other'};
 const response=await run(100,30000,packet,404);expect(JSON.stringify(response)).not.toContain('PRIVATE');
});
it.each([{status:503},{status:429},{message:'unavailable'},new TypeError('offline')])
('does not label Auth outages as invalid login (%j)',async error=>{
 const response=await run(100,30000,null,503,error);expect(response.error).toBe('AUTHENTICATION_UNAVAILABLE');
});
it.each([400,401,403,422])('retains invalid-credential denial for Auth status %s',async status=>{
 const response=await run(100,30000,null,401,{status});expect(response.error).toBe('UNAUTHORIZED');
});
