import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const h=vi.hoisted(()=>({actor:'',session:{access_token:'LOCAL_TEST'},from:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{storage:{from:(bucket:string)=>h.from(bucket)}}}));
import {PrivateChatAttachment} from '@/components/groups/PrivateChatAttachment';
import {privateChatAttachmentReference} from '@/lib/chatAttachment';

const enabled=process.env.VINPOKER_NATIVE_PRIVATE_CHAT==='1';
// Real SDK HTTP + native PG RLS; byte provider/Auth/signing are LOCAL MODELS.
// One rollback-only fixture transaction, NOT durable upload/hosted Storage proof.
describe.skipIf(!enabled)('private chat SDK → loopback adapter → actual PG RLS → fixture bytes',()=>{
 it('allows recipient, denies outsider/public access, expires a real60s bearer and rolls metadata back',async()=>{
  const database='vinpoker_ops_cash115_qualified_c';
  for(const [key,value]of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))expect(process.env[key]).toBe(value);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
  const sql=(input:string)=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:10000,stdio:['pipe','pipe','pipe']}).trim();
  expect(sql("SELECT current_database()||'|'||current_setting('data_directory')||'|'||host(inet_server_addr())||'|'||inet_server_port();"))
   .toBe(`${database}|/tmp/vinpoker-sol-local-20261016-0e79a729/data|127.0.0.1|55441`);
  expect(sql("SELECT count(*) FROM storage.buckets WHERE id='chat-private-v1' AND NOT public;" )).toBe('1');
  expect(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');")).toBe('f');
  const fingerprint=()=>sql("SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.direct_chats c))::text);");
  const before=fingerprint(),actor=randomUUID(),recipient=randomUUID(),outsider=randomUUID(),chat=randomUUID();
  const pg=spawn('wsl',args);let output='',stderr='',finished=false;
  pg.stdout.on('data',v=>output+=v);pg.stderr.on('data',v=>stderr+=v);pg.stdin.on('error',()=>{});
  const done=new Promise<number|null>(resolve=>pg.once('close',code=>{finished=true;resolve(code);}));
  let queue=Promise.resolve();
  const query=(statement:string)=>{
   const task=queue.then(async()=>{
    const marker='CHAT160_'+randomUUID().replaceAll('-',''),offset=output.length;
    pg.stdin.write(statement+`\nSELECT '${marker}';\n`);
    const deadline=Date.now()+10000;
    while(!output.slice(offset).includes(marker)){expect(finished,stderr).toBe(false);expect(Date.now()<deadline,stderr).toBe(true);await new Promise(r=>setTimeout(r,10));}
    return output.slice(offset).split(/\r?\n/).filter(s=>s&&s!==marker).map(s=>JSON.parse(s));
   });queue=task.then(()=>undefined);return task;
  };
  const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
  const authQuery=async(uid:string,statement:string)=>{
   const result=await query(`DO $request$ DECLARE v jsonb;BEGIN
    BEGIN
     PERFORM set_config('request.jwt.claim.sub',${quote(uid)},true);
     PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',${quote(uid)})::text,true);
     PERFORM set_config('role','authenticated',true);${statement}
     PERFORM set_config('role','none',true);INSERT INTO pg_temp.chat160_result VALUES(jsonb_build_object('value',v));
    EXCEPTION WHEN OTHERS THEN PERFORM set_config('role','none',true);INSERT INTO pg_temp.chat160_result VALUES(jsonb_build_object('error',SQLSTATE));END;
   END $request$;SELECT r FROM pg_temp.chat160_result;TRUNCATE pg_temp.chat160_result;`);
   return result[0] as {value?:unknown;error?:string};
  };
  const key=randomBytes(32),bytes=new Map<string,Buffer>(),actors=new Set([actor,recipient,outsider]);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=','base64');
  const server=createServer(async(req,res)=>{
   const reply=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
   try{
    const url=new URL(req.url??'/',`http://${req.headers.host}`);
    const match=url.pathname.match(/^\/storage\/v1\/object\/(sign\/)?chat-private-v1\/(.+)$/);
    if(!match)return reply(403,{statusCode:'403',message:'LOCAL_PRIVATE_ONLY'});
    const path=decodeURIComponent(match[2]);
    if(match[1]&&req.method==='GET'){
     const [payload,signature]=String(url.searchParams.get('token')??'').split('.');
     const expected=createHmac('sha256',key).update(payload??'').digest(),received=Buffer.from(signature??'','base64url');
     if(expected.length!==received.length||!timingSafeEqual(expected,received))return reply(403,{message:'invalid_bearer'});
     const token=JSON.parse(Buffer.from(payload,'base64url').toString());
     if(token.path!==path||token.exp<=Date.now()||!bytes.has(path))return reply(403,{message:'expired_or_missing'});
     res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(bytes.get(path));return;
    }
    const uid=req.headers.authorization?.match(/^Bearer LOCAL_CHAT_TEST_([a-f0-9-]{36})$/)?.[1];
    if(!uid||!actors.has(uid))return reply(401,{message:'local_auth_required'});
    if(req.method!=='POST')return reply(405,{message:'method_not_allowed'});
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10485760)return reply(413,{message:'too_large'});chunks.push(chunk);}
    const raw=Buffer.concat(chunks);
    if(match[1]){
     const body=JSON.parse(raw.toString());if(body.expiresIn!==60)return reply(400,{message:'expected60'});
     const found=await authQuery(uid,`SELECT to_jsonb(o.id) INTO v FROM storage.objects o WHERE o.bucket_id='chat-private-v1' AND o.name=${quote(path)};`);
     if(found.error||!found.value)return reply(403,{statusCode:'403',message:'private_read_denied'});
     const payload=Buffer.from(JSON.stringify({path,exp:Date.now()+60000})).toString('base64url');
     const token=payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
     return reply(200,{signedURL:`/object/sign/chat-private-v1/${path}?token=${token}`});
    }
    if(req.headers['x-upsert']!=='false')return reply(400,{message:'append_only'});
    const added=await authQuery(uid,`INSERT INTO storage.objects(bucket_id,name,metadata)VALUES('chat-private-v1',${quote(path)},jsonb_build_object('size',${raw.length},'mimetype','image/png'))RETURNING to_jsonb(id) INTO v;`);
    if(added.error)return reply(added.error==='23505'?409:403,{statusCode:added.error==='23505'?'409':'403',message:'metadata_rejected'});
    bytes.set(path,raw);reply(200,{Id:added.value,Key:`chat-private-v1/${path}`});
   }catch{reply(500,{message:'local_adapter_failed'});}
  });
  try{
   await query(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='100s';SET LOCAL statement_timeout='5s';GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TEMP TABLE chat160_result(r jsonb);INSERT INTO auth.users(id)VALUES('${actor}'),('${recipient}'),('${outsider}');
    INSERT INTO public.direct_chats(id,user_a,user_b)VALUES('${chat}','${[actor,recipient].sort()[0]}','${[actor,recipient].sort()[1]}');`);
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const address=server.address();expect(address&&typeof address==='object').toBe(true);
   const origin=`http://127.0.0.1:${(address as {port:number}).port}`;
   const clients=new Map([...actors].map(uid=>[uid,createClient(origin,'LOCAL_TEST_ONLY',{global:{headers:{Authorization:`Bearer LOCAL_CHAT_TEST_${uid}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})]));
   h.actor=recipient;h.session={access_token:`LOCAL_CHAT_TEST_${recipient}`};h.from.mockImplementation(bucket=>clients.get(h.actor)!.storage.from(bucket));
   const path=`${actor}/dm/${chat}/${randomUUID()}.png`;
   const upload=await clients.get(actor)!.storage.from('chat-private-v1').upload(path,new Uint8Array(png),{upsert:false,contentType:'image/png'});
   expect(upload.error).toBeNull();
   const duplicate=await clients.get(actor)!.storage.from('chat-private-v1').upload(path,new Uint8Array(png),{upsert:false,contentType:'image/png'});expect(duplicate.error).not.toBeNull();
   const view=render(<PrivateChatAttachment reference={privateChatAttachmentReference(path)} scope={{kind:'dm',id:chat}} type="image" name="LOCAL160 fixture"/>);
   const image=await screen.findByAltText('LOCAL160 fixture',{}, {timeout:5000});const signed=image.getAttribute('src')!;
   const download=await fetch(signed);expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer()).equals(png)).toBe(true);
   expect((await fetch(`${origin}/storage/v1/object/public/chat-private-v1/${path}`)).status).toBe(403);
   h.actor=outsider;h.session={access_token:`LOCAL_CHAT_TEST_${outsider}`};view.rerender(<PrivateChatAttachment reference={privateChatAttachmentReference(path)} scope={{kind:'dm',id:chat}} type="image" name="LOCAL160 fixture"/>);
   expect(screen.queryByAltText('LOCAL160 fixture')).toBeNull();await screen.findByRole('alert',{}, {timeout:5000});
   h.actor=recipient;h.session={access_token:`LOCAL_CHAT_TEST_${recipient}`};view.rerender(<PrivateChatAttachment reference={privateChatAttachmentReference(path)} scope={{kind:'dm',id:chat}} type="image" name="LOCAL160 fixture"/>);
   await screen.findByAltText('LOCAL160 fixture',{}, {timeout:5000});
   // Real wall-clock expiry of the ORIGINAL bearer. Do not fake the clock.
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,61000));});
   expect((await fetch(signed)).status).toBe(403);
   await waitFor(()=>expect(screen.getByAltText('LOCAL160 fixture')).toBeInTheDocument());
   console.log('PRIVATE_CHAT160_REAL_SDK_HTTP_PG_RLS_FIXTURE_BYTES_RECIPIENT_OUTSIDER_REAL60S_EXPIRY_PASS');
  }finally{
   cleanup();const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed;
   if(!pg.stdin.destroyed)pg.stdin.end('ROLLBACK;\n');expect(await done,stderr).toBe(0);bytes.clear();expect(fingerprint()).toBe(before);
  }
 },95000);
});
