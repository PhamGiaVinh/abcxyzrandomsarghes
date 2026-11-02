import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';

it.each(['register','legacy','reentry'].flatMap(path=>[
 {path,code:'23514',message:'multi_day_rules_required_before_registration',conflict:true},
 {path,code:'42501',message:'multi_day_rules_required_before_registration',conflict:false},
 {path,code:'23514',message:'unrelated_check_violation',conflict:false},
 {path,code:undefined,message:'multi_day_rules_required_before_registration',conflict:false},
]))('keeps rules conflict distinct from unknown errors ($path/$code/$message)',async({path,code,message,conflict})=>{
 const tour='11111111-1111-4111-8111-111111111111',club='22222222-2222-4222-8222-222222222222';
 const error={code,message};const writes=vi.fn();
 const rpc=vi.fn(async()=>({data:null,error}));
 const admin={rpc,from:(table:string)=>{
  let columns='',inserted=false;
  const execute=()=>{
   if(inserted){expect(table).toBe('tournament_registrations');return {data:null,error};}
   if(table==='tournaments')return {data:{id:tour,club_id:club,name:'Local TEST',buy_in:100000,rake_amount:10000,
    service_fee_amount:5000,status:'upcoming',start_time:new Date(Date.now()+86400000).toISOString(),free_rake_enabled:false},error:null};
   if(table==='cashier_tour_settings')return {data:{enabled:path!=='legacy'},error:null};
   if(table==='club_payment_config')return {data:null,error:null};
   if(table==='platform_bank_accounts')return {data:columns==='bank_bin'?{bank_bin:'LOCAL_TEST'}
    :{id:'local-bank',bank_name:'TEST',account_number:'LOCAL_TEST_ONLY',account_holder:'TEST',qr_code_url:null},error:null};
   expect(table).toBe('tournament_registrations');return {data:null,error:null};
  };
  const q={select:(value:string)=>{columns=value;return q;},eq:()=>q,in:()=>q,not:()=>q,is:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>execute(),single:async()=>execute(),insert:(value:unknown)=>{writes(table,value);inserted=true;return q;}};
  return q;
 }};
 let handler!:(request:Request)=>Promise<Response>;
 const endpoint=path==='reentry'?'tournament-reentry':'tournament-register';
 const source=readFileSync(`supabase/functions/${endpoint}/index.ts`,'utf8').replace(/^import[^\n]+\n/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:(_url:string,key:string)=>key==='LOCAL_SERVICE'?admin:{auth:{getUser:async()=>({data:{user:{id:'local-player'}},error:null})}},
  retryFetch:()=>{throw Error('No external network');},z:{object:()=>({}),string:()=>({uuid:()=>({})})},
  parseBody:async()=>({ok:true,data:{tournament_id:tour}}),
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_ANON_KEY:'LOCAL_ANON',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_SERVICE'}[key])},serve:(fn:typeof handler)=>{handler=fn;}},
  Request,Response,Date,Math,console,
 });
 const response=await handler(new Request('http://local.invalid/'+endpoint,{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST'}}));
 expect(response.status).toBe(conflict?409:path==='reentry'?503:500);
 const result=await response.json();
 if(conflict)expect(result).toEqual({code:'MAIN_EVENT_RULES_NOT_READY',error:'Main Event chưa khóa rules. Vui lòng liên hệ Floor trước khi đăng ký.'});
 else expect(result.code).toBeUndefined();
 expect(writes.mock.calls.filter(([table])=>table==='notifications')).toHaveLength(0);
 expect(writes).toHaveBeenCalledTimes(path==='legacy'?1:0);
 expect(rpc).toHaveBeenCalledTimes(path==='legacy'?0:1);
});
