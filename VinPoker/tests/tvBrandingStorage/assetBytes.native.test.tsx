import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {File as NodeFile} from 'node:buffer';
import type {Database} from '@/integrations/supabase/types';
const h=vi.hoisted(()=>({actor:'675fe35e-60a8-4452-bb90-e79486d54da6',client:null as unknown,error:vi.fn(),success:vi.fn(),compressed:null as unknown}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:null})}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>h.client}));
vi.mock('@/lib/compressImage',()=>({compressImage:async()=>h.compressed}));
vi.mock('sonner',()=>({toast:{error:h.error,success:h.success}}));
import {TvBrandingEditor} from '@/components/cashier/tournament-live/TvBrandingEditor';
const enabled=process.env.VINPOKER_NATIVE_TV_BYTES==='1';
describe.skipIf(!enabled)('TV actual SDK/HTTP/native metadata with modeled blob provider',()=>{
 it('uploads immutable versioned bytes, publishes a first layout, reloads it and retains the object',async()=>{
  const source='vinpoker_ops_cash115_qualified_c',scratch='vinpoker_tv207_bytes_disposable';
  const marker='VINPOKER_TV207_BYTES_DISPOSABLE',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
  const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
  const query=(db:string,input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1',
   'PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
   {input,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
  const quote=(v:unknown)=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
  const sql=(input:string)=>query(scratch,input);
  const snapshot=()=>query(source,`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),
   (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tv_tournament_layouts l),
   (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.tv_tournament_layout_versions v),
   (SELECT jsonb_agg(to_jsonb(g)) FROM public.centerpoint_tournament_ops_release g))::text);`);
  expect(query(source,'SHOW data_directory;')).toBe('/tmp/vinpoker-sol-local-20261016-0e79a729/data');
  expect(Number(query(source,'SELECT pg_database_size(current_database());'))).toBeLessThan(256*1024*1024);
  expect(query(source,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');")).toBe('0');
  expect(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${scratch}';`)).toBe('0');
  const before=snapshot();let created=false,origin='';const blobs=new Map<string,Buffer>();
  const canonical='https://orlesggcjamwuknxwcpk.supabase.co',auth='LOCAL_TV207_OWNER';
  const asOwner=(statement:string)=>sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${h.actor}';
   SET LOCAL request.jwt.claims='{"sub":"${h.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${statement}COMMIT;`);
  const server=createServer(async(req,res)=>{
   const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   try{
    const url=new URL(req.url!,origin),path=url.pathname;
    const publicMatch=path.match(/^\/storage\/v1\/object\/public\/backing-proofs\/(.+)$/);
    if(req.method==='GET'&&publicMatch){
     const bytes=blobs.get(decodeURIComponent(publicMatch[1]));if(!bytes){reply(404,{message:'missing_blob'});return;}
     res.writeHead(200,{'Content-Type':'image/png'});res.end(bytes);return;
    }
    if(req.headers.authorization!==`Bearer ${auth}`){reply(403,{message:'local_actor_denied'});return;}
    if(req.method==='GET'&&path==='/auth/v1/user'){reply(200,{id:h.actor,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}});return;}
    const match=path.match(/^\/storage\/v1\/object\/backing-proofs\/(.+)$/);
    if(req.method==='POST'&&match){
     const object=decodeURIComponent(match[1]);expect(object).toMatch(new RegExp(`^${h.actor}/tv/branding-logo/v1/[a-f0-9-]{36}\\.png$`));
     const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks);
     let bytes=raw;
     if(req.headers['content-type']?.startsWith('multipart/form-data')){
      const data=await new Response(raw,{headers:{'Content-Type':req.headers['content-type']}}).formData();
      const file=Array.from(data.values()).find(value=>typeof value!=='string');expect(file).toBeTruthy();
      bytes=Buffer.from(await (file as File).arrayBuffer());
     }
     const id=asOwner(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('backing-proofs',${quote(object)},
      jsonb_build_object('size',${bytes.length},'mimetype','image/png')) RETURNING id;`);
     blobs.set(object,bytes);reply(200,{Id:id,Key:'backing-proofs/'+object});return;
    }
    const name=path.replace('/rest/v1/rpc/','');
    expect(['get_tv_tournament_branding_v1','save_tv_tournament_layout_v1']).toContain(name);
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const args=JSON.parse(Buffer.concat(chunks).toString());
    expect(args.p_tournament_id).toBe(tour);
    const types:Record<string,string>=name==='get_tv_tournament_branding_v1'?{p_tournament_id:'uuid'}:{p_tournament_id:'uuid',p_expected_revision:'bigint',p_brand_name:'text',p_logo_url:'text',p_bg_url:'text',p_layout:'jsonb'};
    expect(Object.keys(args).sort()).toEqual(Object.keys(types).sort());
    const params=Object.entries(types).map(([key,type])=>`${key}=>${quote(type==='jsonb'?JSON.stringify(args[key]):args[key])}::${type}`);
    reply(200,JSON.parse(asOwner(`SELECT public.${name}(${params.join(',')});`)));
   }catch(error){reply(400,{message:String((error as {stderr?:unknown}).stderr??(error as Error).message)});}
  });
  try{
   query('postgres',`CREATE DATABASE ${scratch} TEMPLATE ${source};`);created=true;
   query('postgres',`COMMENT ON DATABASE ${scratch} IS '${marker}';`);
   sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
    GRANT USAGE ON SCHEMA auth TO authenticated;`);
   expect(sql(`SELECT count(*) FROM public.tv_tournament_layouts WHERE tournament_id='${tour}' OR event_id='${event}';`)).toBe('0');
   await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();expect(address&&typeof address==='object').toBe(true);
   origin=`http://127.0.0.1:${(address as {port:number}).port}`;
   const client=createClient<Database>(canonical,'local-test-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:`Bearer ${auth}`},fetch:(input,init)=>{
     const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);expect(url.origin).toBe(canonical);
     return fetch(origin+url.pathname+url.search,init);
    }}});h.client=client;
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
   h.compressed=new NodeFile([png],'logo.png',{type:'image/png'});
   globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
   const view=render(<TvBrandingEditor tournamentId={tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
   await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
   const input=screen.getByText('Tournament logo').parentElement!.querySelector('input[type=file]')!;
   fireEvent.change(input,{target:{files:[new File(['codec-test-only'],'logo.png',{type:'image/png'})]}});
   await waitFor(()=>expect(blobs.size).toBe(1));
   await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
   fireEvent.change(screen.getByLabelText('Brand name'),{target:{value:'TV207 byte canary'}});
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
   await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
   const object=Array.from(blobs.keys())[0],url=canonical+'/storage/v1/object/public/backing-proofs/'+object;
   // Event branding is shared; never require a child-tournament layout row.
   expect(sql(`SELECT logo_url FROM public.tv_tournament_layouts WHERE event_id='${event}' AND tournament_id IS NULL;`)).toBe(url);
   expect(sql(`SELECT logo_url FROM public.tv_tournament_layout_versions WHERE logo_url=${quote(url)};`)).toBe(url);
   const download=await fetch(origin+'/storage/v1/object/public/backing-proofs/'+object);
   expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
   const changed=asOwner(`WITH changed AS(UPDATE storage.objects SET metadata='{}' WHERE bucket_id='backing-proofs' AND name=${quote(object)} RETURNING id) SELECT count(*) FROM changed;`);
   expect(changed).toBe('0');expect(blobs.get(object)).toEqual(png);
   view.unmount();render(<TvBrandingEditor tournamentId={tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
   await waitFor(()=>expect(screen.getByRole('img',{name:'proof'})).toHaveAttribute('src',url));
   expect((await fetch(origin+'/storage/v1/object/public/backing-proofs/'+object)).status).toBe(200);
   // Replacing the current head must not erase a version's immutable media.
   fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
   await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
   expect(sql(`SELECT revision||'|'||(logo_url IS NULL) FROM public.tv_tournament_layouts WHERE event_id='${event}';`)).toBe('2|true');
   expect(sql(`SELECT count(*) FROM public.tv_tournament_layout_versions WHERE logo_url=${quote(url)};`)).toBe('1');
   expect(Buffer.from(await (await fetch(origin+'/storage/v1/object/public/backing-proofs/'+object)).arrayBuffer())).toEqual(png);
   const retained=asOwner(`WITH changed AS(UPDATE storage.objects SET metadata='{}' WHERE bucket_id='backing-proofs' AND name=${quote(object)} RETURNING id) SELECT count(*) FROM changed;`);
   expect(retained).toBe('0');
   expect(snapshot()).toBe(before);
   console.log('TV207_ACTUAL_COMPONENT_SDK_HTTP_PG_BYTES_PUBLISH_RELOAD_PASS',JSON.stringify({object,sha256:createHash('sha256').update(png).digest('hex'),sourceUnchanged:true,codec:'fixture',blobProvider:'local-memory-not-hosted'}));
  }finally{
   cleanup();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   expect(snapshot()).toBe(before);
   if(created){expect(query('postgres',`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${scratch}';`)).toBe(marker);query('postgres',`DROP DATABASE ${scratch};`);}
  }
 },45000);
});
