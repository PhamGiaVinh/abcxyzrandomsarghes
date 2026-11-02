import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const h=vi.hoisted(()=>({actor:'',peer:'',read:vi.fn(),write:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:{access_token:'LOCAL_TEST_MODELED_AUTH'},loading:false})}));
vi.mock('react-router-dom',async()=>({...await vi.importActual<typeof import('react-router-dom')>('react-router-dom'),useParams:()=>({userId:h.peer})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 let mode='read',body:unknown,signal:AbortSignal|undefined;const filters:Record<string,string>={};
 const execute=()=>{if(signal?.aborted)return {data:null,error:new Error('LOCAL_REQUEST_ABORTED')};return mode==='read'?h.read(table,filters):h.write(table,mode,filters,body);};
 const q={select:()=>q,eq:(key:string,value:string)=>{filters[key]=value;return q;},order:()=>q,limit:()=>q,abortSignal:(value:AbortSignal)=>{signal=value;return q;},
  insert:(value:unknown)=>{mode='insert';body=value;return q;},update:(value:unknown)=>{mode='update';body=value;return q;},
  single:execute,maybeSingle:execute,then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve().then(execute).then(resolve,reject)};
 return q;
},channel:()=>{const q={on:()=>q,subscribe:()=>q};return q;},removeChannel:vi.fn()}}));
import DirectChat from '@/pages/DirectChat';
const enabled=process.env.VINPOKER_NATIVE_DM_TEXT_UI==='1';
const database='vinpoker_ops_cash115_qualified_c';
const sql=(input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
afterEach(()=>cleanup());
describe.skipIf(!enabled)('actual DM component → authenticated SQL → receipt recovery (modeled HTTP/Auth)',()=>{
 it('commits once, masks response, then recovers exact saved row after remount',async()=>{
  for(const[key,value]of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))expect(process.env[key]).toBe(value);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  expect(sql("SELECT current_database()||'|'||current_setting('data_directory')||'|'||host(inet_server_addr())||'|'||inet_server_port();"))
   .toBe(`${database}|/tmp/vinpoker-sol-local-20261016-0e79a729/data|127.0.0.1|55441`);
  expect(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');")).toBe('f');
  Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});sessionStorage.clear();
  h.actor=randomUUID();h.peer=randomUUID();const chat=randomUUID(),[a,b]=[h.actor,h.peer].sort();let inserts=0;
  const peerName=`LOCAL DM recipient TEST ${h.peer.slice(0,8)}`;
  let deliveryMode:'mask_after'|'drop_before'|'normal'='mask_after',lateBody:Record<string,string>|null=null;
  const readLateBody=():Record<string,string>|null=>lateBody;
  // Synthetic participants/profile/pair only. The message itself must use the product send path.
  sql(`BEGIN;INSERT INTO auth.users(id)VALUES('${h.actor}'),('${h.peer}');
   INSERT INTO public.profiles(user_id,display_name)VALUES('${h.actor}','LOCAL DM sender TEST ${h.actor.slice(0,8)}'),('${h.peer}',${quote(peerName)})
    ON CONFLICT(user_id)DO UPDATE SET display_name=excluded.display_name;
   INSERT INTO public.direct_chats(id,user_a,user_b)VALUES('${chat}','${a}','${b}');COMMIT;`);
  const usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
  const query=(statement:string)=>JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
    SET LOCAL request.jwt.claim.sub='${h.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${h.actor}"}';SET LOCAL ROLE authenticated;
    ${statement}RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
   'cash',(SELECT jsonb_agg(to_jsonb(m)ORDER BY id)FROM public.cashier_buyin_movements m),
   'prizes',(SELECT jsonb_agg(to_jsonb(p)ORDER BY id)FROM public.tournament_prize_payments p))::text);`);
  const before=fingerprint();
  h.read.mockImplementation((table,filters)=>{
   let statement:string;
   if(table==='profiles'){expect(filters).toEqual({user_id:h.peer});statement=`SELECT coalesce((SELECT jsonb_build_object('display_name',display_name,'avatar_url',avatar_url)FROM public.profiles WHERE user_id='${h.peer}'),'null'::jsonb);`;}
   else if(table==='direct_chats'){expect(filters).toEqual({user_a:a,user_b:b});statement=`SELECT coalesce((SELECT jsonb_build_object('id',id)FROM public.direct_chats WHERE user_a='${a}'AND user_b='${b}'),'null'::jsonb);`;}
   else {expect(table).toBe('direct_messages');expect(filters.chat_id).toBe(chat);
    if(filters.id){expect(filters.sender_id).toBe(h.actor);expect(filters.id).toMatch(/^[a-f0-9-]{36}$/i);
     statement=`SELECT coalesce((SELECT to_jsonb(m)FROM public.direct_messages m WHERE id='${filters.id}'AND chat_id='${chat}'AND sender_id='${h.actor}'),'null'::jsonb);`;}
    else statement=`SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY created_at),'[]'::jsonb)FROM public.direct_messages m WHERE chat_id='${chat}';`;
   }return{data:query(statement),error:null};
  });
  h.write.mockImplementation((table,mode,filters,body)=>{
   if(table==='direct_chats'){expect(mode).toBe('update');expect(filters).toEqual({id:chat});
    const marker=h.actor===a?'user_a_last_read_at':'user_b_last_read_at';expect(Object.keys(body)).toEqual([marker]);
    expect(query(`WITH changed AS(UPDATE public.direct_chats SET ${marker}=${quote(body[marker])}::timestamptz WHERE id='${chat}'RETURNING id)SELECT count(*)FROM changed;`)).toBe(1);
    return{data:null,error:null};
   }
   expect(table).toBe('direct_messages');expect(mode).toBe('insert');expect(Object.keys(body).sort()).toEqual(['chat_id','content','id','kind','sender_id']);
   expect(body.chat_id).toBe(chat);expect(body.sender_id).toBe(h.actor);expect(body.kind).toBe('text');expect(body.id).toMatch(/^[a-f0-9-]{36}$/i);
   lateBody={...body};
   if(deliveryMode==='drop_before')return{data:null,error:new Error('LOCAL request not yet delivered')};
   try{
    const receipt=query(`INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)VALUES('${body.id}','${chat}','${h.actor}','text',${quote(body.content)})RETURNING to_jsonb(direct_messages);`);
    expect(receipt.id).toBe(body.id);inserts++;
    return deliveryMode==='mask_after'?{data:null,error:new Error('LOCAL response masked AFTER COMMIT')}:{data:receipt,error:null};
   }catch(error){
    if(/ERROR:\s+23505:/.test(String((error as {stderr?:unknown}).stderr)))return{data:null,error:{code:'23505',message:'LOCAL duplicate message ID'}};
    throw error;
   }
  });
  const first=render(<MemoryRouter><DirectChat/></MemoryRouter>);
  await screen.findByText(peerName);const input=screen.getByRole('textbox');
  fireEvent.change(input,{target:{value:'LOCAL actual component send TEST'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});await waitFor(()=>expect(inserts).toBe(1));
  const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(m))FROM public.direct_messages m WHERE chat_id='${chat}';`));expect(rows).toHaveLength(1);
  expect(rows[0].content).toBe('LOCAL actual component send TEST');
  first.unmount();render(<MemoryRouter><DirectChat/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'}));
  await waitFor(()=>expect(sessionStorage.length).toBe(0));expect(screen.getAllByText('LOCAL actual component send TEST')).toHaveLength(1);
  expect(inserts).toBe(1);expect(fingerprint()).toBe(before);
  deliveryMode='drop_before';
  const secondInput=screen.getByRole('textbox');fireEvent.change(secondInput,{target:{value:'LOCAL late commit same ID TEST'}});fireEvent.keyDown(secondInput,{key:'Enter'});
  const check=await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});fireEvent.click(check);
  await waitFor(()=>expect(secondInput).toBeEnabled());expect(lateBody).not.toBeNull();
  const late=readLateBody();if(!late)throw new Error('Missing exact delayed TEST payload');
  // Deterministic interleaving: receipt read returned NULL, then the original
  // exact payload arrives/commits before the operator's same-ID retry.
  query(`INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)VALUES('${late.id}','${chat}','${h.actor}','text',${quote(late.content)})RETURNING to_jsonb(direct_messages);`);
  inserts++;deliveryMode='normal';fireEvent.keyDown(secondInput,{key:'Enter'});
  await waitFor(()=>expect(sessionStorage.length).toBe(0));expect(inserts).toBe(2);
  expect(screen.getAllByText('LOCAL late commit same ID TEST')).toHaveLength(1);
  expect(sql(`SELECT count(*)FROM public.direct_messages WHERE chat_id='${chat}';`)).toBe('2');expect(fingerprint()).toBe(before);
  expect(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');")).toBe(usage);
  console.log('DIRECT_CHAT_ACTUAL_COMPONENT_SQL_COMMIT_LOST_RESPONSE_RECOVERY_PASS',JSON.stringify({chat,message:rows[0].id,lateMessage:late.id,inserts,model:'LOCAL_COMPONENT_REAL_PG_MODELED_HTTP_AUTH'}));
 },30000);
});
