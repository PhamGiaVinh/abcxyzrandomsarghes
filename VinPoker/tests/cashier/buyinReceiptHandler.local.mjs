import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {canReadBuyinReceipt} from '../../supabase/functions/get-buyin-receipt/access.ts';

/** Actual Edge code + read-only native SQL; Auth is explicitly modeled, not hosted. */
export function createNativeReceiptHandler(sql,getCaller){
 assert.ok(process.env.VINPOKER_NATIVE_PAYOUT==='1'||process.env.VINPOKER_NATIVE_BROWSER==='1');
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 const query=q=>JSON.parse(sql(`BEGIN READ ONLY;${q};ROLLBACK;`)||'null');
 const tables=new Set(['tournament_registrations','seat_draw_receipts','tournaments','clubs','club_members','profiles','cashier_refund_requests','cashier_buyin_movements','user_roles']);
 let handler;
 const admin={from(table){
  assert.ok(tables.has(table));let columns='',where=[],order='',limit='',single=false;
  const build={
   select(value){assert.match(value,/^[a-z_, ]+$/);columns=value;return build;},
   eq(key,value){assert.match(key,/^[a-z_]+$/);where.push(`${key}=${quote(value)}`);return build;},
   is(key,value){assert.match(key,/^[a-z_]+$/);assert.equal(value,null);where.push(`${key} IS NULL`);return build;},
   order(key,{ascending}){assert.match(key,/^[a-z_]+$/);order=` ORDER BY ${key} ${ascending?'ASC':'DESC'}`;return build;},
   limit(value){assert.equal(value,1);limit=' LIMIT 1';return build;},
   maybeSingle(){single=true;return build;},
   then(resolve,reject){try{const result=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${table}${where.length?' WHERE '+where.join(' AND '):''}${order}${limit})t`);
    if(single)assert.ok(result.length<=1);return Promise.resolve({data:single?(result[0]??null):result,error:null}).then(resolve,reject);
   }catch(error){return Promise.reject(error).then(resolve,reject);}},
  };return build;
 },rpc(name,args){assert.ok(['is_club_owner','is_club_cashier'].includes(name));
  return Promise.resolve({data:query(`SELECT to_jsonb(public.${name}(${quote(args._user_id)}::uuid,${quote(args._club_id)}::uuid))`),error:null});}};
 const source=readFileSync('supabase/functions/get-buyin-receipt/index.ts','utf8').replace(/import\s+[\s\S]*?from\s+"[^"]+";/g,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:(_url,key)=>key==='ANON'?{auth:{getUser:async()=>({data:{user:{id:getCaller()}},error:null})}}:admin,
  z,canReadBuyinReceipt,retryFetch:()=>{throw Error('external fetch forbidden');},
  handleOptions:()=>null,corsHeaders:()=>({}),jsonResp:(_req,body,status=200)=>new Response(JSON.stringify(body),{status}),
  parseBody:async(req,schema)=>{const result=schema.safeParse(await req.json());return result.success?{ok:true,data:result.data}:{ok:false,response:new Response('',{status:400})};},
  Deno:{env:{get:key=>({SUPABASE_URL:'http://local.invalid',SUPABASE_ANON_KEY:'ANON',SUPABASE_SERVICE_ROLE_KEY:'SERVICE'}[key])},serve:fn=>{handler=fn;}},console,
 });
 return handler;
}
