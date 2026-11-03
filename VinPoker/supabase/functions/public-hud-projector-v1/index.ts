import {createClient} from 'npm:@supabase/supabase-js@2.105.4';
import {processPublicHudJobs} from './worker.ts';

// Provisioning this function does not enable the read path or schedule a worker.
Deno.serve(async request=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  const expected=Deno.env.get('PUBLIC_HUD_WORKER_SECRET');
  if(!expected||request.headers.get('authorization')!==`Bearer ${expected}`)return reply({error:'UNAUTHORIZED'},401);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'MISCONFIGURED'},500);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const deadline=Date.now()+5_000;
  try{
    const result=await processPublicHudJobs({rpc:async(name,args)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw Error('DEADLINE_EXCEEDED');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),remaining);
      try{return await client.rpc(name,args).abortSignal(controller.signal);}
      finally{clearTimeout(timer);}
    }},20,deadline);
    return reply(result);
  }catch{return reply({error:'WORKER_UNAVAILABLE'},503);}
});
