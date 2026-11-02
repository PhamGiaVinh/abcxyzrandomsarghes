import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const h=vi.hoisted(()=>({user:{id:'actor-a'} as {id:string}|null,session:{access_token:'test-a'},admin:false,write:vi.fn(),read:vi.fn(),search:vi.fn(),signals:[] as AbortSignal[],dmRefresh:()=>{},unread:{perChat:{},error:null as string|null,refresh:vi.fn()}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.user,session:h.session,loading:false,isAdmin:h.admin,isClubAdmin:false})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/useUnreadChats',()=>({useUnreadChats:()=>h.unread}));
vi.mock('@/components/groups/GroupList',()=>({GroupList:()=>null}));
vi.mock('@/components/ui/tabs',()=>({
 Tabs:({children}:{children:ReactNode})=><div>{children}</div>,
 TabsContent:({children}:{children:ReactNode})=><div>{children}</div>,
 TabsList:({children}:{children:ReactNode})=><div>{children}</div>,
 TabsTrigger:({children}:{children:ReactNode})=><span>{children}</span>,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{let search:string|null=null,writing=false;const filters:unknown[]=[];const q={select:()=>q,order:()=>q,in:()=>q,or:()=>q,limit:()=>q,neq:()=>q,
  update:(payload:unknown)=>{writing=true;filters.push(payload);return q;},eq:(column:string,value:unknown)=>{filters.push([column,value]);return q;},maybeSingle:()=>q,
  ilike:(_column:string,value:string)=>{search=value;return q;},abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},
  then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(writing?h.write(table,filters):search===null?h.read(table):h.search(search)).then(resolve,reject)};return q;},
 channel:(name:string)=>{const c={on:(_event:unknown,_filter:unknown,callback:()=>void)=>{if(name==='dm-inbox')h.dmRefresh=callback;return c;},subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
import ChatInbox from './ChatInbox';
const booking={id:'booking-a',player_id:'actor-a',tournament_id:'tour-a',club_id:'club-a',status:'open',updated_at:'2026-10-19T00:00:00Z',archived_at:null};
function packet(table:string){return{data:table==='booking_chats'?[booking]:table==='direct_chats'?[{id:'dm-a',user_a:'actor-a',user_b:'friend-a',last_message_at:'2026-10-19T00:00:00Z'}]:table==='profiles'?[{user_id:'friend-a',display_name:'PRIVATE FRIEND'}]:table==='chat_messages'?[{chat_id:'booking-a',content:'PRIVATE BOOKING',kind:'text'}]:table==='direct_messages'?[{chat_id:'dm-a',sender_id:'friend-a',content:'PRIVATE DM',kind:'text'}]:[],error:null};}
function deferred(){let resolve!:(v:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
const view=()=> <MemoryRouter><ChatInbox/></MemoryRouter>;
describe('ChatInbox private account incarnation',()=>{
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
 beforeEach(()=>{h.user={id:'actor-a'};h.session={access_token:'test-a'};h.admin=false;h.write.mockReset();h.read.mockReset().mockImplementation(packet);h.search.mockReset().mockResolvedValue({data:[],error:null});h.signals=[];h.unread.error=null;h.unread.refresh.mockReset().mockResolvedValue(undefined);});
 const archivedAt='2026-10-18T00:00:00Z';
 const archivedRead=(table:string)=>table==='booking_chats'?{data:[{...booking,archived_at:archivedAt}],error:null}:packet(table);
 it('shows an unarchive failure without exposing backend text or pretending the row moved',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);h.write.mockResolvedValue({data:null,error:{message:'PRIVATE backend body'}});
  vi.spyOn(console,'error').mockImplementation(()=>{});
  render(view());const button=await screen.findByRole('button',{name:'chatInbox.unarchive'});fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('chatInbox.unarchiveUnknown');
  expect(screen.queryByText('PRIVATE backend body')).toBeNull();expect(button).toBeDisabled();
  expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('blocks two immediate unarchive clicks and binds the write to the displayed archived timestamp',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);const write=deferred();h.write.mockReturnValue(write.promise);
  render(view());const button=await screen.findByRole('button',{name:'chatInbox.unarchive'});
  fireEvent.click(button);fireEvent.click(button);await act(async()=>{});
  expect(h.write).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
  expect(h.write.mock.calls[0]).toEqual(['booking_chats',[{archived_at:null},['id','booking-a'],['archived_at',archivedAt]]]);
 });
 it('does not accept a zero-row unarchive as confirmation; fresh read recovery never retries the write',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);h.write.mockResolvedValue({data:null,error:null});
  render(view());fireEvent.click(await screen.findByRole('button',{name:'chatInbox.unarchive'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('chatInbox.unarchiveUnknown');
  fireEvent.click(screen.getByRole('button',{name:'chatInbox.retry'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button',{name:'chatInbox.unarchive'})).not.toBeDisabled();expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('moves an archived row only after a matching acknowledgement and canonical refresh',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);
  h.write.mockImplementation(()=>{h.read.mockImplementation(packet);return {data:{id:'booking-a',archived_at:null},error:null};});
  render(view());fireEvent.click(await screen.findByRole('button',{name:'chatInbox.unarchive'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'chatInbox.unarchive'})).toBeNull());
  expect(screen.getByText('PRIVATE BOOKING')).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('bounds an unarchive response and ignores late success without retrying it',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);const write=deferred();h.write.mockReturnValue(write.promise);
  render(view());const button=await screen.findByRole('button',{name:'chatInbox.unarchive'});vi.useFakeTimers();
  fireEvent.click(button);await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(screen.getByRole('alert')).toHaveTextContent('chatInbox.unarchiveUnknown');expect(button).toBeDisabled();
  await act(async()=>write.resolve({data:{id:'booking-a',archived_at:null},error:null}));
  expect(screen.getByRole('alert')).toHaveTextContent('chatInbox.unarchiveUnknown');expect(button).toBeDisabled();expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('does not unlock an unknown unarchive from a read started before the write',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);h.write.mockResolvedValue({data:null,error:{message:'503'}});
  render(view());const button=await screen.findByRole('button',{name:'chatInbox.unarchive'});
  const old=deferred();h.read.mockImplementation(table=>table==='booking_chats'?old.promise:packet(table));
  fireEvent(document,new Event('visibilitychange'));await act(async()=>{});
  fireEvent.click(button);await screen.findByRole('alert');
  await act(async()=>old.resolve(archivedRead('booking_chats')));
  expect(button).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('chatInbox.unarchiveUnknown');expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('ignores an old unarchive completion after account replacement',async()=>{
  h.admin=true;h.read.mockImplementation(archivedRead);const write=deferred();h.write.mockReturnValue(write.promise);
  const mounted=render(view());fireEvent.click(await screen.findByRole('button',{name:'chatInbox.unarchive'}));
  h.user={id:'actor-b'};h.session={access_token:'test-b'};h.read.mockResolvedValue({data:[],error:null});mounted.rerender(view());
  await screen.findByText('chatInbox.noBookings');const reads=h.read.mock.calls.length;
  await act(async()=>write.resolve({data:{id:'booking-a',archived_at:null},error:null}));
  expect(h.read).toHaveBeenCalledTimes(reads);expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByText('PRIVATE BOOKING')).toBeNull();expect(h.write).toHaveBeenCalledTimes(1);
 });
 it('does not replace a newer search with a late older response',async()=>{
  render(view());await screen.findByText('PRIVATE DM');vi.useFakeTimers();
  const old=deferred(),current=deferred();h.search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const input=screen.getByPlaceholderText('chatInbox.searchUsers');
  fireEvent.change(input,{target:{value:'Alice'}});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  fireEvent.change(input,{target:{value:'Bob'}});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  await act(async()=>current.resolve({data:[{user_id:'friend-b',display_name:'CURRENT BOB'}],error:null}));
  expect(screen.getByText('CURRENT BOB')).toBeInTheDocument();
  await act(async()=>old.resolve({data:[{user_id:'friend-old',display_name:'STALE ALICE'}],error:null}));
  expect(screen.queryByText('STALE ALICE')).toBeNull();expect(screen.getByText('CURRENT BOB')).toBeInTheDocument();
 });
 it('bounds a hung search and ignores its late result instead of claiming no matches',async()=>{
  render(view());await screen.findByText('PRIVATE DM');vi.useFakeTimers();const old=deferred();h.search.mockReturnValue(old.promise);
  fireEvent.change(screen.getByPlaceholderText('chatInbox.searchUsers'),{target:{value:'Alice'}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_300);});
  expect(screen.getByRole('status')).toHaveTextContent('chatInbox.searchFail');expect(h.signals.at(-1)?.aborted).toBe(true);
  await act(async()=>old.resolve({data:[{user_id:'friend-old',display_name:'LATE ALICE'}],error:null}));
  expect(screen.queryByText('LATE ALICE')).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('chatInbox.searchFail');
  h.search.mockResolvedValue({data:[{user_id:'friend-new',display_name:'RETRIED ALICE'}],error:null});
  fireEvent.click(screen.getByRole('button',{name:'chatInbox.retry'}));await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(screen.getByText('RETRIED ALICE')).toBeInTheDocument();expect(screen.queryByRole('status')).toBeNull();
 });
 it('hides previous clickable results immediately for a new query and after clearing input',async()=>{
  render(view());await screen.findByText('PRIVATE DM');vi.useFakeTimers();
  h.search.mockResolvedValueOnce({data:[{user_id:'old',display_name:'OLD MATCH'}],error:null});
  const input=screen.getByPlaceholderText('chatInbox.searchUsers');
  fireEvent.change(input,{target:{value:'Alice'}});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(screen.getByText('OLD MATCH')).toBeInTheDocument();
  const old=deferred();h.search.mockReturnValueOnce(old.promise);
  fireEvent.change(input,{target:{value:'Bob'}});expect(screen.queryByText('OLD MATCH')).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});fireEvent.change(input,{target:{value:''}});
  expect(h.signals.at(-1)?.aborted).toBe(true);
  await act(async()=>old.resolve({data:[{user_id:'late',display_name:'CLEARED MATCH'}],error:null}));
  expect(screen.queryByText('CLEARED MATCH')).toBeNull();expect(screen.queryByRole('status')).toBeNull();
 });
 it('shows a search error rather than no matches for a failed search read',async()=>{
  render(view());await screen.findByText('PRIVATE DM');vi.useFakeTimers();h.search.mockResolvedValue({data:null,error:{message:'503'}});
  fireEvent.change(screen.getByPlaceholderText('chatInbox.searchUsers'),{target:{value:'Alice'}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(screen.getByRole('status')).toHaveTextContent('chatInbox.searchFail');expect(screen.queryByText('chatInbox.noResultsFor')).toBeNull();
 });
 it('exposes unread failure without discarding loaded chats, retries only its read and clears after recovery',async()=>{
  h.unread.error='Không xác minh được số tin nhắn chưa đọc.';
  const mounted=render(view());await screen.findByText('PRIVATE BOOKING');
  expect(screen.getByRole('status')).toHaveTextContent(h.unread.error);
  fireEvent.click(screen.getByRole('button',{name:'chatInbox.retry'}));
  expect(h.unread.refresh).toHaveBeenCalledWith({silent:true});
  expect(screen.getByText('PRIVATE BOOKING')).toBeInTheDocument();
  h.unread.error=null;mounted.rerender(view());
  expect(screen.queryByRole('status')).toBeNull();expect(screen.getByText('PRIVATE BOOKING')).toBeInTheDocument();
 });
 it('does not turn a failed DM primary read into no conversations and recovers explicitly',async()=>{
  h.read.mockImplementation(table=>table==='direct_chats'?{data:null,error:{message:'503'}}:packet(table));
  render(view());await screen.findByText('PRIVATE BOOKING');
  expect(await screen.findByRole('status')).toHaveTextContent('chatInbox.loadFail');
  expect(screen.queryByText('chatInbox.noDM')).toBeNull();
  h.read.mockImplementation(packet);fireEvent.click(screen.getByRole('button',{name:'chatInbox.retry'}));
  await screen.findByText('PRIVATE DM');expect(screen.queryByRole('status')).toBeNull();
 });
 for(const kind of ['malformed','rejected'] as const)it(`does not claim empty after ${kind} DM read`,async()=>{
  h.read.mockImplementation(table=>table==='direct_chats'?(kind==='malformed'?{data:null,error:null}:Promise.reject(new Error('Failed to fetch'))):packet(table));
  render(view());expect(await screen.findByRole('status')).toHaveTextContent('chatInbox.loadFail');
  expect(screen.queryByText('chatInbox.noDM')).toBeNull();
 });
 for(const failedTable of ['profiles','direct_messages'])it(`retains the last complete DM snapshot if secondary ${failedTable} fails during refresh`,async()=>{
  render(view());await screen.findByText('PRIVATE DM');
  h.read.mockImplementation(table=>table===failedTable?{data:null,error:{message:'503'}}:packet(table));
  await act(async()=>{await h.dmRefresh();});
  expect(await screen.findByRole('status')).toHaveTextContent('chatInbox.loadFail');
  expect(screen.getByText('PRIVATE DM')).toBeInTheDocument();expect(screen.getByText('PRIVATE FRIEND')).toBeInTheDocument();
 });
 for(const table of ['chat_messages','direct_messages'])it(`bounds the whole ${table} read and ignores its result after retry`,async()=>{
  render(view());await screen.findByText('PRIVATE BOOKING');await screen.findByText('PRIVATE DM');vi.useFakeTimers();
  const old=deferred();h.read.mockImplementation(name=>name===table?old.promise:packet(name));
  if(table==='direct_messages'){act(()=>{void h.dmRefresh();});await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});}
  else {fireEvent(document,new Event('visibilitychange'));await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});}
  expect(screen.getByText('chatInbox.loadFail')).toBeInTheDocument();
  expect(screen.getByText('PRIVATE BOOKING')).toBeInTheDocument();expect(screen.getByText('PRIVATE DM')).toBeInTheDocument();
  h.read.mockImplementation(packet);fireEvent.click(screen.getByRole('button',{name:'chatInbox.retry'}));
  await act(async()=>{await Promise.resolve();});
  await act(async()=>old.resolve({data:[{chat_id:'booking-a',content:'LATE BOOKING',kind:'text'},{chat_id:'dm-a',content:'LATE DM',kind:'text'}],error:null}));
  expect(screen.queryByText('LATE BOOKING')).toBeNull();expect(screen.queryByText('LATE DM')).toBeNull();
 });
 it('coalesces DM refresh bursts while a read is in flight',async()=>{
  const old=deferred();h.read.mockImplementation(table=>table==='direct_chats'?old.promise:packet(table));
  render(view());await waitFor(()=>expect(h.read.mock.calls.filter(([table])=>table==='direct_chats')).toHaveLength(1));
  act(()=>{void h.dmRefresh();void h.dmRefresh();void h.dmRefresh();});
  expect(h.read.mock.calls.filter(([table])=>table==='direct_chats')).toHaveLength(1);
  h.read.mockImplementation(packet);await act(async()=>old.resolve(packet('direct_chats')));
  await waitFor(()=>expect(h.read.mock.calls.filter(([table])=>table==='direct_chats')).toHaveLength(2));
 });
 it('does not poll bookings while hidden and refreshes on visible reconnect',async()=>{
  vi.useFakeTimers();render(view());await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  const initial=h.read.mock.calls.filter(([table])=>table==='booking_chats').length;expect(initial).toBe(1);
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  await act(async()=>{await vi.advanceTimersByTimeAsync(45_000);});
  expect(h.read.mock.calls.filter(([table])=>table==='booking_chats')).toHaveLength(initial);
  visibility.mockReturnValue('visible');fireEvent(window,new Event('online'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(h.read.mock.calls.filter(([table])=>table==='booking_chats')).toHaveLength(initial+1);
  const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
  expect(h.read.mock.calls.filter(([table])=>table==='booking_chats')).toHaveLength(initial+1);
  online.mockReturnValue(true);fireEvent(window,new Event('online'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(h.read.mock.calls.filter(([table])=>table==='booking_chats')).toHaveLength(initial+2);
 });
 for(const change of ['actor','session'] as const){
  it(`hides loaded booking and DM content immediately on ${change} replacement`,async()=>{
   const mounted=render(view());await screen.findByText('PRIVATE BOOKING');await screen.findByText('PRIVATE DM');
   h.read.mockImplementation(()=>new Promise(()=>{}));
   if(change==='actor')h.user={id:'actor-b'};else h.session={access_token:'test-b'};
   mounted.rerender(view());
   expect(screen.queryByText('PRIVATE BOOKING')).toBeNull();expect(screen.queryByText('PRIVATE DM')).toBeNull();expect(screen.queryByText('PRIVATE FRIEND')).toBeNull();
  });
 }
 it('does not publish actor A late secondary reads into actor B inbox',async()=>{
  const old=deferred();h.read.mockImplementation(table=>table==='chat_messages'||table==='direct_messages'?old.promise:packet(table));
  const mounted=render(view());await waitFor(()=>expect(h.read.mock.calls.some(([table])=>table==='direct_messages')).toBe(true));
  h.user={id:'actor-b'};h.read.mockResolvedValue({data:[],error:null});mounted.rerender(view());
  await act(async()=>old.resolve({data:[{chat_id:'booking-a',content:'LATE PRIVATE',kind:'text'},{chat_id:'dm-a',content:'LATE PRIVATE DM',kind:'text'}],error:null}));
  expect(screen.queryByText('LATE PRIVATE')).toBeNull();expect(screen.queryByText('LATE PRIVATE DM')).toBeNull();
 });
 it('does not revive an old actor booking after the new actor authoritative empty read',async()=>{
  const old=deferred();h.read.mockImplementation(table=>table==='booking_chats'?old.promise:{data:[],error:null});
  const mounted=render(view());await waitFor(()=>expect(h.read).toHaveBeenCalledWith('booking_chats'));
  h.user={id:'actor-b'};h.read.mockResolvedValue({data:[],error:null});mounted.rerender(view());
  await act(async()=>old.resolve({data:[booking],error:null}));
  expect(mounted.container.querySelector('a[href^="/chat/tour-a"]')).toBeNull();
 });
});
