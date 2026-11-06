// Candidate Edge transport, copied ONLY into a disposable runtime by the
// explicit reentry_transport_probe. Production Edge remains unchanged.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const BodySchema=z.object({tournament_id:z.string().uuid()});
Deno.serve(async(req)=>{
 const started=performance.now(),timings:string[]=[];
 async function timed<T>(phase:'auth'|'registration',task:()=>PromiseLike<T>):Promise<T>{
  const at=performance.now();try{return await task();}
  finally{timings.push(`reentry_${phase};dur=${(performance.now()-at).toFixed(3)};desc="1"`);}
 }
 function j(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json',
   'Server-Timing':[...timings,`reentry_total;dur=${(performance.now()-started).toFixed(3)}`].join(', ')}});
 }
 if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 if(req.method!=='POST')return j({error:'Method not allowed'},405);
 try{
  const authHeader=req.headers.get('Authorization');if(!authHeader)return j({error:'Missing auth'},401);
  const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,
   {global:{headers:{Authorization:authHeader},fetch:retryFetch}});
  const {data:userData,error:authError}=await timed('auth',()=>userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i,'')));
  if(authError){const unavailable=authError.status===0||(authError.status??0)>=500;
   return j({error:unavailable?'Authentication unavailable':'Invalid token'},unavailable?503:401);}
  if(!userData?.user?.id)return j({error:'Invalid token'},401);
  const parsed=await parseBody(req,BodySchema,corsHeaders);if(!parsed.ok)return parsed.response;
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data,error}=await timed('registration',()=>admin.rpc('cashier_app_reentry_transport_v1',{
   p_tournament_id:parsed.data.tournament_id,p_player_id:userData.user.id,
  }));
  if(error)return j({error:'Re-entry unavailable'},503);
  if(!data||![200,400,404,409,503].includes(data.status)||!data.body||typeof data.body!=='object'||Array.isArray(data.body))
   return j({error:'Re-entry unavailable'},503);
  return j(data.body,data.status);
 }catch{return j({error:'Re-entry unavailable'},500);}
});
