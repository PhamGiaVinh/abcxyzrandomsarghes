import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {processPublicSpectatorJobs} from './worker.ts';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async request=>{
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  const expected=Deno.env.get('PUBLIC_SPECTATOR_WORKER_SECRET')??'';
  const supplied=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')??'';
  if(!expected||supplied!==expected)return reply({error:'unauthorized'},401);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'server_configuration'},500);
  const client=createClient(url,key,{auth:{persistSession:false}}),deadline=Date.now()+5_000;
  try{
    return reply(await processPublicSpectatorJobs({rpc:async(name,args)=>{
      const remaining=deadline-Date.now();if(remaining<=0)throw Error('deadline_exceeded');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);
      try{return await client.rpc(name,args).abortSignal(controller.signal);}
      finally{clearTimeout(timer);}
    }},deadline));
  }catch{return reply({error:'projection_unavailable'},503);}
});
