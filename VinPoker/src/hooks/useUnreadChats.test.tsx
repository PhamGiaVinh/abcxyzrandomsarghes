import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({user:{id:'actor-a'} as {id:string}|null,session:{access_token:'test-session-a'},chats:vi.fn(),messages:vi.fn(),sound:vi.fn(),remove:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.user,session:h.session,loading:false})}));
vi.mock('@/lib/notifySound',()=>({playNotifySound:h.sound}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:()=>({select:()=>({
  is:(...args:unknown[])=>({abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return h.chats(...args);}}),
  in:(...args:unknown[])=>({abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return h.messages(...args);}}),
 })}),
 channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:h.remove,
}}));
import {useUnreadChats} from './useUnreadChats';
const chat={id:'chat-a',player_id:'actor-a',player_last_read_at:null,club_last_read_at:null};
const message={chat_id:'chat-a',sender_id:'other',created_at:'2026-10-18T01:00:00Z',kind:'text'};
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
describe('booking unread actor/read boundaries',()=>{
 afterEach(()=>{vi.useRealTimers();});
 beforeEach(()=>{h.signals=[];h.user={id:'actor-a'};h.session={access_token:'test-session-a'};h.chats.mockReset().mockResolvedValue({data:[chat],error:null});h.messages.mockReset().mockResolvedValue({data:[message],error:null});h.sound.mockReset();h.remove.mockReset();});
 it('drops retained unread and late work when the same actor receives a new session',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  const old=deferred();h.messages.mockReturnValueOnce(old.promise);
  act(()=>{void hook.result.current.refresh();});await waitFor(()=>expect(h.messages).toHaveBeenCalledTimes(2));
  h.session={access_token:'test-session-b'};h.chats.mockResolvedValue({data:[],error:null});hook.rerender();
  expect(hook.result.current.count).toBe(0);expect(hook.result.current.perChat).toEqual({});
  await act(async()=>old.resolve({data:[message,message],error:null}));
  expect(hook.result.current.count).toBe(0);expect(hook.result.current.perChat).toEqual({});expect(h.sound).not.toHaveBeenCalled();
 });
 it('clears count and per-chat private data immediately on logout',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  h.user=null;hook.rerender();expect(hook.result.current.count).toBe(0);expect(hook.result.current.perChat).toEqual({});expect(h.remove).toHaveBeenCalled();
 });
 it('ignores late actor A messages after actor B loads',async()=>{
  const old=deferred();h.messages.mockReturnValueOnce(old.promise);
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(h.messages).toHaveBeenCalledTimes(1));
  h.user={id:'actor-b'};h.chats.mockResolvedValue({data:[],error:null});hook.rerender();
  await act(async()=>old.resolve({data:[message],error:null}));
  expect(hook.result.current.count).toBe(0);expect(hook.result.current.perChat).toEqual({});expect(h.sound).not.toHaveBeenCalled();
 });
 it('preserves same-actor last good data and marks read error',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  h.chats.mockResolvedValue({data:null,error:{message:'503'}});
  await act(async()=>{await hook.result.current.refresh();});
  expect(hook.result.current.count).toBe(1);expect(hook.result.current.error).toBeTruthy();
 });
 it('handles rejected refresh without unhandled rejection or false empty',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  h.messages.mockRejectedValue(new Error('Failed to fetch'));
  await act(async()=>{await hook.result.current.refresh();});
  expect(hook.result.current.count).toBe(1);expect(hook.result.current.error).toBeTruthy();
 });
 it('does not revive the first A response after A-B-A',async()=>{
  const old=deferred();h.messages.mockReturnValueOnce(old.promise);
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(h.messages).toHaveBeenCalledTimes(1));
  h.user={id:'actor-b'};h.chats.mockResolvedValue({data:[],error:null});hook.rerender();
  h.user={id:'actor-a'};hook.rerender();
  await act(async()=>old.resolve({data:[message],error:null}));
  expect(hook.result.current.count).toBe(0);expect(hook.result.current.perChat).toEqual({});
 });
 it('coalesces refresh bursts without discarding the completed read',async()=>{
  const first=deferred();h.chats.mockReturnValueOnce(first.promise);
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(h.chats).toHaveBeenCalledTimes(1));
  act(()=>{void hook.result.current.refresh();void hook.result.current.refresh();void hook.result.current.refresh();});
  expect(h.chats).toHaveBeenCalledTimes(1);
  await act(async()=>first.resolve({data:[chat],error:null}));
  await waitFor(()=>expect(h.chats).toHaveBeenCalledTimes(2));
  expect(hook.result.current.count).toBe(1);expect(h.sound).not.toHaveBeenCalled();
 });
 it('releases a hung read at the deadline and ignores its late result after a successful retry',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  vi.useFakeTimers();
  const old=deferred();h.chats.mockReturnValueOnce(old.promise);
  act(()=>{void hook.result.current.refresh();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
  expect(hook.result.current.error).toBeTruthy();expect(hook.result.current.count).toBe(1);
  expect(h.signals.at(-1)?.aborted).toBe(true);
  h.chats.mockResolvedValue({data:[],error:null});
  await act(async()=>{await hook.result.current.refresh();});
  expect(hook.result.current.error).toBeNull();expect(hook.result.current.count).toBe(0);
  await act(async()=>old.resolve({data:[chat],error:null}));
  expect(hook.result.current.count).toBe(0);expect(h.sound).not.toHaveBeenCalled();
 });
 it('settles an in-flight refresh when its actor scope is disposed',async()=>{
  const hook=renderHook(useUnreadChats);await waitFor(()=>expect(hook.result.current.count).toBe(1));
  const old=deferred();h.messages.mockReturnValueOnce(old.promise);
  let finished=false;
  act(()=>{void hook.result.current.refresh().then(()=>{finished=true;});});
  await waitFor(()=>expect(h.messages).toHaveBeenCalledTimes(2));
  h.user=null;hook.rerender();
  await act(async()=>{await Promise.resolve();});
  expect(finished).toBe(true);expect(hook.result.current.perChat).toEqual({});
  expect(h.signals.at(-1)?.aborted).toBe(true);
 });
 it('bounds the whole two-query read rather than restarting the deadline for messages',async()=>{
  vi.useFakeTimers();
  const chats=deferred(),messages=deferred();
  h.chats.mockReturnValueOnce(chats.promise);h.messages.mockReturnValueOnce(messages.promise);
  const hook=renderHook(useUnreadChats);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);chats.resolve({data:[chat],error:null});});
  expect(h.messages).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5_000);});
  expect(hook.result.current.error).toBeTruthy();
  h.chats.mockResolvedValue({data:[],error:null});
  await act(async()=>{await hook.result.current.refresh();messages.resolve({data:[message],error:null});});
  expect(hook.result.current.count).toBe(0);expect(hook.result.current.error).toBeNull();
  expect(h.sound).not.toHaveBeenCalled();
 });
});
