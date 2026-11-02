import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'actor-a',session:{access_token:'session-a'},realtime:null as null|((event:{new:unknown})=>void),users:{'actor-a':{id:'actor-a'},'new-scope':{id:'new-scope'}} as Record<string,{id:string}>,recipient:'person-a',read:vi.fn(),write:vi.fn(),upload:vi.fn(),error:vi.fn(),nav:vi.fn()}));
vi.mock('react-router-dom',async()=>{const actual=await vi.importActual<typeof import('react-router-dom')>('react-router-dom');return {...actual,useParams:()=>({userId:h.recipient}),useNavigate:()=>h.nav};});
const translate=(key:string)=>key;
vi.mock('react-i18next',()=>({useTranslation:()=>({t:translate,i18n:{language:'vi'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.users[h.actor],session:h.session,loading:false})}));
vi.mock('sonner',()=>({toast:{error:h.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 storage:{from:()=>({upload:h.upload,getPublicUrl:(path:string)=>({data:{publicUrl:`https://test.invalid/${path}`}})})},
 from:(table:string)=>{let action='read',values:unknown;const filters:Record<string,string>={};const q={
  select:()=>q,eq:(key:string,value:string)=>{filters[key]=value;return q;},order:()=>q,limit:()=>q,abortSignal:(signal:AbortSignal)=>{initialSignals.push(signal);return q;},
  insert:(value:unknown)=>{action='insert';values=value;return q;},update:()=>{action='update';return q;},
  maybeSingle:()=>h.read(table,filters),single:()=>h.write(table,action,filters,values),
  then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(action==='read'?h.read(table,filters):h.write(table,action,filters,values)).then(resolve,reject),
 };return q;},channel:()=>{const c={on:(_event:unknown,_filter:unknown,callback:(event:{new:unknown})=>void)=>{h.realtime=callback;return c;},subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
import DirectChat from './DirectChat';
const initialSignals:AbortSignal[]=[];
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
describe('DirectChat scope and read failures',()=>{
 afterEach(()=>vi.useRealTimers());
 beforeEach(()=>{
  sessionStorage.clear();
  initialSignals.length=0;
  Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});
  h.actor='actor-a';h.session={access_token:'session-a'};h.realtime=null;h.recipient='person-a';h.read.mockReset().mockImplementation((table,filters)=>({data:table==='profiles'?{display_name:filters.user_id}:table==='direct_chats'?{id:'chat-a'}:[{id:'message-a',sender_id:'person-a',kind:'text',content:'PRIVATE OLD MESSAGE',created_at:'2026-10-18T00:00:00Z'}],error:null}));
  h.write.mockReset().mockResolvedValue({data:null,error:null});h.error.mockReset();h.nav.mockReset();
  h.upload.mockReset().mockResolvedValue({data:null,error:null});
 });
 it.each(['profiles','direct_chats','direct_messages'])('bounds hung initial %s and ignores late data after explicit retry',async(target)=>{
  vi.useFakeTimers();const pending=deferred(),normal=h.read.getMockImplementation()!;let hanging=true;
  h.read.mockImplementation((table,filters)=>table===target&&hanging?pending.promise:normal(table,filters));
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await act(async()=>{});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(screen.getByRole('alert')).toHaveTextContent('Không tải được cuộc trò chuyện');
  expect(initialSignals.length).toBeGreaterThan(0);
  expect(initialSignals.every(signal=>signal.aborted)).toBe(true);
  expect(h.write.mock.calls.some(([table,action])=>table==='direct_chats'&&action==='update')).toBe(false);
  hanging=false;await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Thử tải lại cuộc trò chuyện'})));
  expect(screen.getByText('PRIVATE OLD MESSAGE')).toBeInTheDocument();
  const markerCount=h.write.mock.calls.filter(([table,action])=>table==='direct_chats'&&action==='update').length;
  await act(async()=>pending.resolve({data:target==='profiles'?{display_name:'LATE OLD PROFILE'}:target==='direct_chats'?{id:'late-old-chat'}:[{id:'late-old',sender_id:'person-a',kind:'text',content:'LATE OLD MESSAGE',created_at:'2026-10-18T00:00:00Z'}],error:null}));
  expect(screen.queryByText('LATE OLD PROFILE')).not.toBeInTheDocument();
  expect(screen.queryByText('LATE OLD MESSAGE')).not.toBeInTheDocument();
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_chats'&&action==='update')).toHaveLength(markerCount);
 });
 it('resolves a timed-out get-or-create by reading the existing pair on retry, not blindly reinserting',async()=>{
  vi.useFakeTimers();const pending=deferred(),normal=h.read.getMockImplementation()!;let created=false;
  h.read.mockImplementation((table,filters)=>table==='direct_chats'?{data:created?{id:'chat-a'}:null,error:null}:normal(table,filters));
  h.write.mockImplementation((table,action)=>table==='direct_chats'&&action==='insert'?pending.promise:{data:null,error:null});
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await act(async()=>{});
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_chats'&&action==='insert')).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(screen.getByRole('alert')).toHaveTextContent('Không tải được cuộc trò chuyện');
  expect(initialSignals.every(signal=>signal.aborted)).toBe(true);
  created=true;await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Thử tải lại cuộc trò chuyện'})));
  expect(screen.getByText('PRIVATE OLD MESSAGE')).toBeInTheDocument();
  await act(async()=>pending.resolve({data:{id:'chat-a'},error:null}));
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_chats'&&action==='insert')).toHaveLength(1);
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_chats'&&action==='update')).toHaveLength(1);
 });
 it('uses the authenticated owner folder and a unique object name for DM images',async()=>{
  const mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  await waitFor(()=>expect(h.upload).toHaveBeenCalledTimes(1));
  expect(h.upload.mock.calls[0][0]).toMatch(/^actor-a\/dm\/chat-a\/[a-f0-9-]{36}\.png$/);
  await waitFor(()=>expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1));
  const payload=h.write.mock.calls.find(([table,action])=>table==='direct_messages'&&action==='insert')![3];
  expect(payload.content).toBe(`private-chat:v1:${h.upload.mock.calls[0][0]}`);
  expect(payload.content).not.toContain('http');
 });
 it('serializes same-tick image picks and blocks a simultaneous text send',async()=>{
  const pending=deferred();h.upload.mockReturnValue(pending.promise);
  const mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const input=mounted.container.querySelector('input[type=file]')!;
  fireEvent.change(screen.getByPlaceholderText('directChat.typeMsg'),{target:{value:'TEST separate text'}});
  act(()=>{
   const image=new File(['TEST'],'local.png',{type:'image/png'});
   fireEvent.change(input,{target:{files:[image]}});fireEvent.change(input,{target:{files:[image]}});
   fireEvent.keyDown(screen.getByPlaceholderText('directChat.typeMsg'),{key:'Enter'});
  });
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(0);
  await act(async()=>pending.resolve({data:null,error:null}));
  await waitFor(()=>expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1));
 });
 it('retains an image message identity after commit response loss and resolves it after remount without reupload',async()=>{
  let receipt:Record<string,unknown>|null=null;
  const normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='direct_messages'&&filters.id?{data:receipt,error:null}:normal(table,filters));
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert'){receipt={...body,created_at:'2026-10-21T00:00:00Z'};return{data:null,error:{message:'LOCAL image response lost'}};}
   return{data:null,error:null};
  });
  const first=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.change(first.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});
  expect(receipt!.id).toMatch(/^[a-f0-9-]{36}$/i);expect(sessionStorage.length).toBe(1);
  first.unmount();render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'}));
  await waitFor(()=>expect(sessionStorage.length).toBe(0));
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1);
 });
 it('does not upload an image while a text send is in flight or unresolved',async()=>{
  const pending=deferred(),mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  h.write.mockImplementation((table,action)=>table==='direct_messages'&&action==='insert'?pending.promise:{data:null,error:null});
  fireEvent.change(screen.getByPlaceholderText('directChat.typeMsg'),{target:{value:'LOCAL pending text'}});
  const choose=()=>fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  act(()=>{fireEvent.keyDown(screen.getByPlaceholderText('directChat.typeMsg'),{key:'Enter'});choose();});
  expect(h.upload).not.toHaveBeenCalled();
  await act(async()=>pending.resolve({data:null,error:new Error('LOCAL response lost')}));
  choose();expect(h.upload).not.toHaveBeenCalled();
 });
 it('retries a missing image with the same message and object only after explicit receipt read',async()=>{
  let count=0;const normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='direct_messages'&&filters.id?{data:null,error:null}:normal(table,filters));
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert')return ++count===1?{data:null,error:{message:'LOCAL not delivered'}}:{data:{...body,created_at:'2026-10-21T00:00:00Z'},error:null};
   return{data:null,error:null};
  });
  const mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});
  expect(screen.queryByRole('button',{name:'Gửi lại ảnh đang chờ'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra tin nhắn đang chờ'}));
  const retry=await screen.findByRole('button',{name:'Gửi lại ảnh đang chờ'});
  act(()=>{fireEvent.click(retry);fireEvent.click(retry);});
  await waitFor(()=>expect(sessionStorage.length).toBe(0));
  const writes=h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert');
  expect(writes).toHaveLength(2);expect(writes[1][3]).toEqual(writes[0][3]);expect(h.upload).toHaveBeenCalledTimes(1);
 });
 it('bounds an uncertain image message insert and ignores its late acknowledgement',async()=>{
  vi.useFakeTimers();const pending=deferred();let sent:Record<string,unknown>={};
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert'){sent={...body,created_at:'2026-10-21T00:00:00Z'};return pending.promise;}
   return{data:null,error:null};
  });
  const mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await act(async()=>{});
  fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  // Flush the real WebCrypto digest before advancing the bounded response timer.
  await act(async()=>{await vi.waitFor(()=>expect(h.write.mock.calls.some(([table,action])=>table==='direct_messages'&&action==='insert')).toBe(true));});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác nhận được ảnh đã gửi');
  expect(sessionStorage.length).toBe(1);
  await act(async()=>pending.resolve({data:sent,error:null}));
  expect(sessionStorage.length).toBe(1);expect(screen.getByRole('button',{name:'directChat.sendImg'})).toBeDisabled();
 });
 it('does not insert an old-scope image message after account replacement',async()=>{
  const pending=deferred();h.upload.mockReturnValue(pending.promise);
  const mounted=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'local.png',{type:'image/png'})]}});
  await waitFor(()=>expect(h.upload).toHaveBeenCalledTimes(1));
  h.actor='new-scope';mounted.rerender(<MemoryRouter><DirectChat/></MemoryRouter>);
  await act(async()=>pending.resolve({data:null,error:null}));
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(0);
 });
 it('serializes same-tick Enter sends and supplies one durable message ID',async()=>{
  const pending=deferred();render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  h.write.mockImplementation((table,action)=>table==='direct_messages'&&action==='insert'?pending.promise:{data:null,error:null});
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL TEST SEND'}});
  act(()=>{fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});});
  await waitFor(()=>expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1));
  const calls=h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert');
  expect(calls[0][3].id).toMatch(/^[a-f0-9-]{36}$/i);
  await act(async()=>pending.resolve({data:null,error:new Error('LOCAL response lost')}));
 });
 it('keeps an unknown send pending rather than offering another new insert',async()=>{
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  h.write.mockImplementation((table,action)=>table==='direct_messages'&&action==='insert'?{data:null,error:new Error('LOCAL response lost')}:{data:null,error:null});
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL TEST SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});
  fireEvent.keyDown(input,{key:'Enter'});
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1);
 });
 it('shows only the confirmed row and deduplicates a realtime echo',async()=>{
  let receipt:Record<string,unknown>={};
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert'){receipt={...body,created_at:'2026-10-19T01:00:00Z'};return{data:receipt,error:null};}
   return{data:null,error:null};
  });
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL CONFIRMED SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByText('LOCAL CONFIRMED SEND');await waitFor(()=>expect(input).toHaveValue(''));
  await act(async()=>h.realtime!({new:receipt}));
  expect(screen.getAllByText('LOCAL CONFIRMED SEND')).toHaveLength(1);expect(sessionStorage.length).toBe(0);
 });
 it('recovers a lost committed response after remount without another insert',async()=>{
  let receipt:Record<string,unknown>|null=null;
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert'){receipt={...body,created_at:'2026-10-19T01:00:00Z'};return{data:null,error:new Error('LOCAL lost after commit')};}
   return{data:null,error:null};
  });
  const original=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='direct_messages'&&filters.id?{data:receipt,error:null}:original(table,filters));
  const first=render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL RECOVERED SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});
  expect(Array.from({length:sessionStorage.length},(_,n)=>sessionStorage.getItem(sessionStorage.key(n)!)).join('')).not.toContain('LOCAL RECOVERED SEND');
  first.unmount();render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'}));
  await screen.findByText('LOCAL RECOVERED SEND');expect(sessionStorage.length).toBe(0);
  expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(1);
  expect(h.read).toHaveBeenCalledWith('direct_messages',{id:receipt!.id,chat_id:'chat-a',sender_id:'actor-a'});
 });
 it('reuses the original ID only after a missing receipt and exact content retry',async()=>{
  let writes=0;
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert')return++writes===1?{data:null,error:new Error('LOCAL not delivered')}:{data:{...body,created_at:'2026-10-19T01:00:00Z'},error:null};
   return{data:null,error:null};
  });
  const original=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='direct_messages'&&filters.id?{data:null,error:null}:original(table,filters));
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL SAME KEY SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'}));
  await waitFor(()=>expect(input).toBeEnabled());
  fireEvent.change(input,{target:{value:'DIFFERENT PAYLOAD'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByText('Hãy nhập lại đúng nội dung tin nhắn đang chờ để gửi cùng mã.');expect(writes).toBe(1);
  fireEvent.change(input,{target:{value:'LOCAL SAME KEY SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByText('LOCAL SAME KEY SEND');
  const inserts=h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert');
  expect(inserts).toHaveLength(2);expect(inserts[1][3]).toEqual(inserts[0][3]);expect(sessionStorage.length).toBe(0);
 });
 it.each([null,{id:'other',chat_id:'chat-a',sender_id:'actor-a',kind:'text',content:'LOCAL UNCONFIRMED',created_at:'2026-10-19T00:00:00Z'}])('does not clear the draft for an unconfirmed successful response',async(data)=>{
  h.write.mockImplementation((table,action)=>table==='direct_messages'&&action==='insert'?{data,error:null}:{data:null,error:null});
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL UNCONFIRMED'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});expect(input).toHaveValue('LOCAL UNCONFIRMED');
  expect(screen.queryByText('LOCAL UNCONFIRMED')).toBeNull();expect(sessionStorage.length).toBe(1);
 });
 it('does not dispatch a message when the journal cannot be retained',async()=>{
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL storage unavailable');});
  try{
   const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'LOCAL NOT SENT'}});fireEvent.keyDown(input,{key:'Enter'});
   await screen.findByText('Chưa gửi tin nhắn vì không chuẩn bị được mã thao tác. Hãy tải lại cuộc trò chuyện rồi thử lại.');
   expect(h.write.mock.calls.filter(([table,action])=>table==='direct_messages'&&action==='insert')).toHaveLength(0);
  }finally{set.mockRestore();}
 });
 it('does not apply an old actor send acknowledgement to the new conversation',async()=>{
  const pending=deferred();let sent:Record<string,unknown>={};
  h.write.mockImplementation((table,action,_filters,body)=>{
   if(table==='direct_messages'&&action==='insert'){sent={...body,created_at:'2026-10-19T01:00:00Z'};return pending.promise;}
   return{data:null,error:null};
  });
  const view=()=> <MemoryRouter><DirectChat/></MemoryRouter>;const mounted=render(view());await screen.findByText('PRIVATE OLD MESSAGE');
  const input=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(input,{target:{value:'OLD ACTOR PRIVATE SEND'}});fireEvent.keyDown(input,{key:'Enter'});
  await screen.findByRole('button',{name:'Kiểm tra tin nhắn đang chờ'});
  h.actor='new-scope';h.read.mockImplementation(table=>({data:table==='profiles'?{display_name:'NEW PEER'}:table==='direct_chats'?{id:'chat-b'}:[],error:null}));mounted.rerender(view());
  await screen.findByText('NEW PEER');const fresh=screen.getByPlaceholderText('directChat.typeMsg');fireEvent.change(fresh,{target:{value:'NEW ACTOR DRAFT'}});
  await act(async()=>pending.resolve({data:sent,error:null}));
  expect(fresh).toHaveValue('NEW ACTOR DRAFT');expect(screen.queryByText('OLD ACTOR PRIVATE SEND')).toBeNull();expect(sessionStorage.length).toBe(1);
 });
 it('hides private messages and draft when the same actor receives a new session',async()=>{
  const view=()=> <MemoryRouter><DirectChat/></MemoryRouter>;const mounted=render(view());
  await screen.findByText('PRIVATE OLD MESSAGE');fireEvent.change(screen.getByPlaceholderText('directChat.typeMsg'),{target:{value:'PRIVATE SESSION DRAFT'}});
  h.read.mockImplementation(()=>new Promise(()=>{}));h.session={access_token:'session-b'};mounted.rerender(view());
  expect(screen.queryByText('PRIVATE OLD MESSAGE')).toBeNull();expect(screen.queryByDisplayValue('PRIVATE SESSION DRAFT')).toBeNull();
 });
 it('does not duplicate a persisted message when realtime delivers the same insert twice',async()=>{
  render(<MemoryRouter><DirectChat/></MemoryRouter>);await screen.findByText('PRIVATE OLD MESSAGE');
  await waitFor(()=>expect(h.realtime).not.toBeNull());
  const message={id:'message-b',sender_id:'person-a',kind:'text',content:'NEW PRIVATE MESSAGE',created_at:'2026-10-18T00:01:00Z'};
  await act(async()=>{h.realtime!({new:message});h.realtime!({new:message});});
  expect(screen.getAllByText('NEW PRIVATE MESSAGE')).toHaveLength(1);
 });
 for(const scope of ['actor','recipient'] as const){
  it(`hides prior conversation and draft immediately after ${scope} change`,async()=>{
   const view=()=> <MemoryRouter><DirectChat/></MemoryRouter>;const mounted=render(view());
   await screen.findByText('PRIVATE OLD MESSAGE');fireEvent.change(screen.getByPlaceholderText('directChat.typeMsg'),{target:{value:'PRIVATE OLD DRAFT'}});
   h.read.mockImplementation(()=>new Promise(()=>{}));h[scope]='new-scope';mounted.rerender(view());
   expect(screen.queryByText('PRIVATE OLD MESSAGE')).toBeNull();expect(screen.queryByDisplayValue('PRIVATE OLD DRAFT')).toBeNull();
  });
 }
 it('does not continue get-or-create for a recipient whose profile read arrived late',async()=>{
  const old=deferred();h.read.mockImplementation((table,filters)=>table==='profiles'&&filters.user_id==='person-a'?old.promise:Promise.resolve({data:table==='profiles'?{display_name:'NEW PERSON'}:table==='direct_chats'?{id:'chat-b'}:[],error:null}));
  const view=()=> <MemoryRouter><DirectChat/></MemoryRouter>;const mounted=render(view());
  await waitFor(()=>expect(h.read).toHaveBeenCalledWith('profiles',{user_id:'person-a'}));
  h.recipient='person-b';mounted.rerender(view());await screen.findByText('NEW PERSON');
  await act(async()=>old.resolve({data:{display_name:'OLD PERSON'},error:null}));
  expect(screen.queryByText('OLD PERSON')).toBeNull();expect(h.read.mock.calls.some(([table,filters])=>table==='direct_chats'&&filters.user_b==='person-a')).toBe(false);
 });
 it('shows a retryable read error instead of user-not-found or empty conversation',async()=>{
  h.read.mockResolvedValue({data:null,error:{message:'503 LOCAL'}});render(<MemoryRouter><DirectChat/></MemoryRouter>);
  expect(await screen.findByRole('alert')).toBeTruthy();expect(h.nav).not.toHaveBeenCalled();expect(h.write).not.toHaveBeenCalled();
 });
 it('recovers the exact conversation with an explicit read retry',async()=>{
  h.read.mockResolvedValueOnce({data:null,error:{message:'503 LOCAL'}});render(<MemoryRouter><DirectChat/></MemoryRouter>);
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Thử tải lại cuộc trò chuyện'}));
  await screen.findByText('PRIVATE OLD MESSAGE');expect(screen.queryByRole('alert')).toBeNull();
 });
 it('resolves a concurrent unique-pair create through the same pair read',async()=>{
  let pairReads=0;
  h.read.mockImplementation((table,filters)=>({data:table==='profiles'?{display_name:filters.user_id}:table==='direct_chats'?(++pairReads===1?null:{id:'chat-a'}):[],error:null}));
  h.write.mockImplementation((_table,action)=>action==='insert'?{data:null,error:{code:'23505',message:'pair exists'}}:{data:null,error:null});
  render(<MemoryRouter><DirectChat/></MemoryRouter>);
  await screen.findByText('directChat.noMessages');expect(pairReads).toBe(2);expect(h.error).not.toHaveBeenCalled();
 });
});
