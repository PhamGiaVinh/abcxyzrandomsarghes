import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'a',group:'g-a',session:{access_token:'session-a'},users:{a:{id:'a'},b:{id:'b'}} as Record<string,{id:string}>,read:vi.fn(),write:vi.fn(),rpc:vi.fn(),upload:vi.fn(),nav:vi.fn(),error:vi.fn()}));
vi.mock('react-router-dom',async()=>({...await vi.importActual<typeof import('react-router-dom')>('react-router-dom'),useParams:()=>({groupId:h.group}),useNavigate:()=>h.nav}));
const t=(key:string)=>key;
vi.mock('react-i18next',()=>({useTranslation:()=>({t,i18n:{language:'vi'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.users[h.actor],session:h.session,loading:false})}));
vi.mock('sonner',()=>({toast:{error:h.error,success:vi.fn()}}));
vi.mock('@/components/groups/GroupMembersDialog',()=>({GroupMembersDialog:()=>null}));
vi.mock('@/components/groups/InviteLinkDialog',()=>({InviteLinkDialog:()=>null}));
vi.mock('@/components/groups/MessageAttachment',()=>({MessageAttachment:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:h.rpc,
 from:(table:string)=>{let action='read',values:unknown;const filters:Record<string,string>={};const q={
  select:()=>q,eq:(key:string,value:string)=>{filters[key]=value;return q;},lt:(key:string,value:string)=>{filters['before_'+key]=value;return q;},
  or:(value:string)=>{filters.or=value;filters.before_created_at=value.match(/^created_at\.lt\.([^,]+)/)?.[1]??'';return q;},
  is:()=>q,in:()=>q,order:(key:string)=>{filters.order=filters.order?`${filters.order},${key}`:key;return q;},limit:()=>q,
  update:()=>{action='update';return q;},insert:(value:unknown)=>{action='insert';values=value;return q;},
  maybeSingle:()=>h.read(table,filters),
  then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(action==='read'?h.read(table,filters):h.write(table,action,filters,values)).then(resolve,reject),
 };return q;},storage:{from:()=>({upload:h.upload,getPublicUrl:()=>({data:{publicUrl:'http://test.invalid/attachment'}})})},channel:()=>{const c={on:()=>c,subscribe:()=>c,send:vi.fn()};return c;},removeChannel:vi.fn(),
}}));
import GroupChat from './GroupChat';
const view=()=> <MemoryRouter><GroupChat/></MemoryRouter>;
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
beforeEach(()=>{
 Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:vi.fn()});
 h.actor='a';h.group='g-a';h.session={access_token:'session-a'};h.nav.mockReset();h.error.mockReset();
 h.upload.mockReset();
 h.rpc.mockReset();vi.stubGlobal('confirm',()=>true);
 h.read.mockReset().mockImplementation((table,filters)=>({data:table==='chat_groups'?{id:filters.id,name:filters.id,is_public:false,created_by:'owner',deleted_at:null}
  :table==='chat_group_members'?[{user_id:h.actor}]:table==='profiles'?[]:[{id:'m-a',group_id:filters.group_id,sender_id:'peer',content:'PRIVATE GROUP MESSAGE',created_at:'2026-10-18T00:00:00Z'}],error:null}));
 h.write.mockReset().mockResolvedValue({data:null,error:null});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('GroupChat scoped reads',()=>{
 it('clears private history and drafts immediately on same-actor session replacement',async()=>{
  const mounted=render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'OLD SESSION PRIVATE DRAFT'}});
  h.read.mockImplementation(()=>new Promise(()=>{}));h.session={access_token:'session-b'};
  mounted.rerender(view());
  expect(screen.queryByText('PRIVATE GROUP MESSAGE')).toBeNull();
  expect(screen.queryByDisplayValue('OLD SESSION PRIVATE DRAFT')).toBeNull();
  expect(screen.getByRole('textbox')).toBeDisabled();
 });
 it('rejects a delayed initial read from a replaced session of the same actor',async()=>{
  const delayed=deferred(),normal=h.read.getMockImplementation()!;let reads=0;
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'&&++reads===1?delayed.promise:normal(table,filters));
  const mounted=render(view());await waitFor(()=>expect(h.read.mock.calls.some(([table])=>table==='chat_group_messages')).toBe(true));
  h.session={access_token:'session-b'};mounted.rerender(view());
  await screen.findByText('PRIVATE GROUP MESSAGE');h.write.mockClear();
  await act(async()=>delayed.resolve({data:[{id:'old-session-message',group_id:'g-a',sender_id:'peer',content:'LATE SESSION PRIVATE MESSAGE',created_at:'2026-10-18T00:00:00Z'}],error:null}));
  expect(screen.queryByText('LATE SESSION PRIVATE MESSAGE')).toBeNull();expect(h.write).not.toHaveBeenCalled();
 });
 it.each(['chat_groups','chat_group_members','chat_group_messages','profiles'])('bounds a hung initial %s read and ignores late data after retry',async(table)=>{
  vi.useFakeTimers();const normal=h.read.getMockImplementation()!,hung=deferred();let fail=true;
  h.read.mockImplementation((name,filters)=>name===table&&fail?hung.promise:normal(name,filters));
  render(view());await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
  expect(screen.getByRole('button',{name:'Thử tải lại nhóm'})).toBeEnabled();
  expect(h.write).not.toHaveBeenCalled();
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Thử tải lại nhóm'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(screen.getByText('PRIVATE GROUP MESSAGE')).toBeTruthy();
  await act(async()=>hung.resolve(table==='chat_groups'?{data:{id:'g-a',name:'LATE OLD GROUP',created_by:'owner',is_public:false},error:null}
   :table==='profiles'?{data:[{user_id:'peer',display_name:'LATE OLD PROFILE'}],error:null}
   :{data:[],error:null}));
  expect(screen.queryByText('LATE OLD GROUP')).toBeNull();expect(screen.queryByText('LATE OLD PROFILE')).toBeNull();
  expect(screen.getByText('PRIVATE GROUP MESSAGE')).toBeTruthy();
 });
 const page=()=>Array.from({length:50},(_,n)=>({id:`81100000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,group_id:'g-a',sender_id:'peer',content:`CURRENT PAGE ${n}`,created_at:new Date(Date.UTC(2026,9,18,0,0,n)).toISOString()}));
 it('loads every same-timestamp message across a page boundary with stable ID ordering',async()=>{
  const normal=h.read.getMockImplementation()!,stamp='2026-10-18T00:00:00.123456+00:00';
  const rows=Array.from({length:55},(_,n)=>({...page()[0],id:`81100000-0000-4000-8000-${String(55-n).padStart(12,'0')}`,created_at:stamp,content:`TIED MESSAGE ${55-n}`}));
  h.read.mockImplementation((table,filters)=>{
   if(table!=='chat_group_messages')return normal(table,filters);
   const cursor=filters.or?.match(/id\.lt\.([a-f0-9-]+)/)?.[1];
   return {data:filters.before_created_at&&!cursor?[]:rows.filter(m=>!cursor||m.id<cursor).slice(0,50),error:null};
  });
  const mounted=render(view());await screen.findByText('TIED MESSAGE 55');
  fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);
  await screen.findByText('TIED MESSAGE 1');
  expect(screen.getAllByText(/^TIED MESSAGE /)).toHaveLength(55);
  const calls=h.read.mock.calls.filter(([table])=>table==='chat_group_messages');
  expect(calls).toHaveLength(2);expect(calls.every(([,f])=>f.order==='created_at,id')).toBe(true);
  expect(calls[1][1].or).toBe(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${rows[49].id})`);
 });
 it.each(['id','created_at'] as const)('rejects unsafe %s cursor before dispatching raw filters',async(field)=>{
  const normal=h.read.getMockImplementation()!,rows=page();
  rows[49]={...rows[49],[field]:field==='id'?'bad),group_id.neq.foreign':'2026-10-18T00:00:00Z,group_id.neq.foreign'};
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?{data:rows,error:null}:normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');
  fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);
  await screen.findByRole('button',{name:'Thử tải tin nhắn cũ'});
  expect(h.read.mock.calls.filter(([table])=>table==='chat_group_messages')).toHaveLength(1);
 });
 it('coalesces overlapping older-page reads and preserves current messages',async()=>{
  const normal=h.read.getMockImplementation()!,older=deferred();
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?(filters.before_created_at?older.promise:{data:page(),error:null}):normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');
  const scroll=mounted.container.querySelector('.overflow-y-auto')!;
  act(()=>{fireEvent.scroll(scroll);fireEvent.scroll(scroll);});
  await waitFor(()=>expect(h.read.mock.calls.filter(([table,f])=>table==='chat_group_messages'&&f.before_created_at)).toHaveLength(1));
  await act(async()=>older.resolve({data:[{...page()[0],id:'older',content:'OLDER PAGE'}],error:null}));
  expect(screen.getByText('CURRENT PAGE 0')).toBeTruthy();expect(screen.getByText('OLDER PAGE')).toBeTruthy();
 });
 it('keeps a failed older page retryable instead of marking history exhausted',async()=>{
  const normal=h.read.getMockImplementation()!;let attempts=0;
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?(filters.before_created_at
   ?++attempts===1?{data:null,error:{message:'503'}}:{data:[{...page()[0],id:'older',content:'RECOVERED OLDER'}],error:null}
   :{data:page(),error:null}):normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);
  const retry=await screen.findByRole('button',{name:'Thử tải tin nhắn cũ'});
  expect(screen.getByText('CURRENT PAGE 0')).toBeTruthy();fireEvent.click(retry);
  await screen.findByText('RECOVERED OLDER');expect(attempts).toBe(2);
 });
 it('does not append an old group page after the actor/group scope changes',async()=>{
  const normal=h.read.getMockImplementation()!,older=deferred();
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'&&filters.group_id==='g-a'
   ?filters.before_created_at?older.promise:{data:page(),error:null}:normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);
  await waitFor(()=>expect(h.read.mock.calls.some(([,f])=>f.before_created_at)).toBe(true));
  h.group='g-b';mounted.rerender(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  await act(async()=>older.resolve({data:[{...page()[0],id:'private-old',content:'LATE PRIVATE OLD GROUP'}],error:null}));
  expect(screen.queryByText('LATE PRIVATE OLD GROUP')).toBeNull();expect(screen.getByText('PRIVATE GROUP MESSAGE')).toBeTruthy();
 });
 it.each(['null','wrong-group','throw'])('retains current messages and offers recovery for %s older-page response',async(mode)=>{
  const normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?(filters.before_created_at
   ?mode==='throw'?Promise.reject(new TypeError('read failed')):{data:mode==='null'?null:[{...page()[0],group_id:'g-foreign',content:'FOREIGN MESSAGE'}],error:null}
   :{data:page(),error:null}):normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);
  await screen.findByRole('button',{name:'Thử tải tin nhắn cũ'});
  expect(screen.getByText('CURRENT PAGE 0')).toBeTruthy();expect(screen.queryByText('FOREIGN MESSAGE')).toBeNull();
 });
 it('bounds a hung older read without accepting its late response or duplicating reads',async()=>{
  const normal=h.read.getMockImplementation()!,older=deferred();let attempts=0;
  h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?(filters.before_created_at
   ?(++attempts,older.promise):{data:page(),error:null}):normal(table,filters));
  const mounted=render(view());await screen.findByText('CURRENT PAGE 0');vi.useFakeTimers();
  act(()=>{fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(screen.getByRole('button',{name:'Thử tải tin nhắn cũ'})).toBeTruthy();expect(attempts).toBe(1);
  fireEvent.scroll(mounted.container.querySelector('.overflow-y-auto')!);expect(attempts).toBe(1);
  await act(async()=>older.resolve({data:[{...page()[0],id:'late',content:'LATE TIMED OUT PAGE'}],error:null}));
  expect(screen.queryByText('LATE TIMED OUT PAGE')).toBeNull();expect(screen.getByText('CURRENT PAGE 0')).toBeTruthy();
 });
 it.each([true,false])('accepts only an exact owner-delete server outcome; valid=%s',async(valid)=>{
  const normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>{const result=normal(table,filters);return table==='chat_groups'?{...result,data:{...result.data,created_by:'a'}}:result;});
  h.rpc.mockResolvedValue({data:valid?{ok:true,outcome:'deleted',groupId:'g-a',deletedAt:'2026-10-18T00:00:00Z'}:{ok:true},error:null});
  render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  fireEvent.click(screen.getByTitle('groupChat.chat.deleteTitle'));
  await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('soft_delete_chat_group_v1',{p_group_id:'g-a'}));
  if(valid)await waitFor(()=>expect(h.nav).toHaveBeenCalledWith('/inbox'));
  else {await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.nav).not.toHaveBeenCalled();}
 });
 for(const change of ['actor','group'] as const)it(`clears old private messages and draft immediately on ${change} change`,async()=>{
  const mounted=render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'PRIVATE GROUP DRAFT'}});
  h.read.mockImplementation(()=>new Promise(()=>{}));h[change]=change==='actor'?'b':'g-b';mounted.rerender(view());
  expect(screen.queryByText('PRIVATE GROUP MESSAGE')).toBeNull();expect(screen.queryByDisplayValue('PRIVATE GROUP DRAFT')).toBeNull();
 });
 it('does not mark an old group read after its delayed membership response',async()=>{
  const delayed=deferred(),normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='chat_group_members'&&filters.group_id==='g-a'?delayed.promise:normal(table,filters));
  const mounted=render(view());await waitFor(()=>expect(h.read).toHaveBeenCalledWith('chat_group_members',{group_id:'g-a'}));
  h.group='g-b';mounted.rerender(view());await screen.findByText('PRIVATE GROUP MESSAGE');h.write.mockClear();
  await act(async()=>delayed.resolve({data:[{user_id:'a'}],error:null}));
  expect(h.write.mock.calls.some(([table,,filters])=>table==='chat_group_members'&&filters.group_id==='g-a')).toBe(false);
 });
 it('treats network failure as a retryable error, not forbidden',async()=>{
  h.read.mockResolvedValueOnce({data:null,error:{message:'503 LOCAL'}});render(view());
  expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('groupChat.chat.forbidden')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại nhóm'}));await screen.findByText('PRIVATE GROUP MESSAGE');
 });
 it('does not show message read failure as an empty group',async()=>{
  const normal=h.read.getMockImplementation()!;h.read.mockImplementation((table,filters)=>table==='chat_group_messages'?{data:null,error:{message:'503 LOCAL'}}:normal(table,filters));
  render(view());await screen.findByRole('alert');expect(screen.queryByText('groupChat.chat.emptyTitle')).toBeNull();
 });
 it('keeps a successful non-member response forbidden and does not load messages',async()=>{
  const normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='chat_group_members'?{data:[{user_id:'someone-else'}],error:null}:normal(table,filters));
  render(view());await screen.findByText('groupChat.chat.forbidden');
  expect(h.read.mock.calls.some(([table])=>table==='chat_group_messages')).toBe(false);
  expect(h.write).not.toHaveBeenCalled();
 });
 it('does not revive the first A scope after A→B→A membership reads',async()=>{
  const delayed=deferred(),normal=h.read.getMockImplementation()!;let reads=0;
  h.read.mockImplementation((table,filters)=>table==='chat_group_members'&&filters.group_id==='g-a'&&++reads===1?delayed.promise:normal(table,filters));
  const mounted=render(view());await waitFor(()=>expect(h.read).toHaveBeenCalledWith('chat_group_members',{group_id:'g-a'}));
  h.group='g-b';mounted.rerender(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  h.group='g-a';mounted.rerender(view());await screen.findByText('PRIVATE GROUP MESSAGE');h.write.mockClear();
  await act(async()=>delayed.resolve({data:[],error:null}));
  expect(screen.queryByText('groupChat.chat.forbidden')).toBeNull();expect(h.write).not.toHaveBeenCalled();
 });
 it('does not send while membership is still being verified',async()=>{
  const delayed=deferred(),normal=h.read.getMockImplementation()!;
  h.read.mockImplementation((table,filters)=>table==='chat_group_members'?delayed.promise:normal(table,filters));
  render(view());await waitFor(()=>expect(h.read).toHaveBeenCalledWith('chat_group_members',{group_id:'g-a'}));
  const input=screen.getByRole('textbox');expect(input).toBeDisabled();
  fireEvent.change(input,{target:{value:'UNVERIFIED'}});fireEvent.keyDown(input,{key:'Enter'});
  expect(h.write.mock.calls.filter(([,action])=>action==='insert')).toHaveLength(0);
 });
 it('coalesces same-tick Enter sends rather than inserting the message twice',async()=>{
  render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'HELLO TEST'}});
  const delayed=deferred();h.write.mockImplementation((_,action)=>action==='insert'?delayed.promise:{data:null,error:null});
  act(()=>{fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});});
  await waitFor(()=>expect(h.write.mock.calls.filter(([,action])=>action==='insert')).toHaveLength(1));
  await act(async()=>delayed.resolve({data:null,error:null}));
 });
 it('keeps the draft and releases sending after a rejected insert',async()=>{
  render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  h.write.mockImplementation((_,action)=>action==='insert'?Promise.reject(new TypeError('network')):{data:null,error:null});
  const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'UNCONFIRMED TEST'}});fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(h.error).toHaveBeenCalledWith(expect.stringContaining('Chưa xác minh')));
  expect(input).toHaveValue('UNCONFIRMED TEST');expect(input).toBeEnabled();
 });
 it('does not insert an attachment into the old group after an actor switch during upload',async()=>{
  const mounted=render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  const delayed=deferred();h.upload.mockReturnValue(delayed.promise);
  const file=mounted.container.querySelector('input[type="file"]')!;
  fireEvent.change(file,{target:{files:[new File(['TEST'],'test.txt',{type:'text/plain'})]}});
  fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'});await waitFor(()=>expect(h.upload).toHaveBeenCalledOnce());
  h.actor='b';mounted.rerender(view());await screen.findByText('PRIVATE GROUP MESSAGE');h.write.mockClear();
  await act(async()=>delayed.resolve({error:null}));
  expect(h.write.mock.calls.filter(([,action])=>action==='insert')).toHaveLength(0);
 });
 it('stores a stable private object reference instead of a public/signed attachment URL',async()=>{
  const mounted=render(view());await screen.findByText('PRIVATE GROUP MESSAGE');
  h.upload.mockResolvedValueOnce({error:null});
  fireEvent.change(mounted.container.querySelector('input[type=file]')!,{target:{files:[new File(['TEST'],'test.txt',{type:'text/plain'})]}});
  fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'});
  await waitFor(()=>expect(h.write.mock.calls.filter(([table,action])=>table==='chat_group_messages'&&action==='insert')).toHaveLength(1));
  const payload=h.write.mock.calls.find(([table,action])=>table==='chat_group_messages'&&action==='insert')![3];
  expect(payload.attachment_url).toBe(`private-chat:v1:${h.upload.mock.calls[0][0]}`);
  expect(payload.attachment_url).toMatch(/^private-chat:v1:a\/groups\/g-a\/[a-f0-9-]{36}\.txt$/);
 });
});
