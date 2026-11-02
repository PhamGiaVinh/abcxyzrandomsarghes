import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {LobbyTableSummary} from '@/lib/onlinePoker/types';
const h=vi.hoisted(()=>({load:vi.fn(),events:[] as (()=>void)[],remove:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{channel:()=>{const q={on:(_event:unknown,_filter:unknown,fn:()=>void)=>{h.events.push(fn);return q;},subscribe:()=>q};return q;},removeChannel:h.remove}}));
vi.mock('@/lib/onlinePoker/types',async original=>({...await original<typeof import('@/lib/onlinePoker/types')>(),RUNTIME_LIVE:true}));
vi.mock('@/lib/onlinePoker/client',()=>({listTablesLive:(...args:unknown[])=>h.load(...args),onlinePokerClient:{}}));
vi.mock('@/lib/pokerLiveSound',()=>({playPokerLiveSound:vi.fn()}));
import {useLobby} from '@/lib/onlinePoker/useOnlinePoker';
const table:LobbyTableSummary={id:'TABLE_TEST',name:'TEST',sb:'100',bb:'200',maxSeats:9,seatedCount:2,status:'open'};
beforeEach(()=>{vi.clearAllMocks();h.events=[];});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('exposes reads only, not an unkeyed create mutation',async()=>{
 h.load.mockResolvedValue([]);const {result}=renderHook(()=>useLobby());
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current).not.toHaveProperty('createTable');
});
it('coalesces a realtime burst until the current read completes, without discarding that result',async()=>{
 let first!:(v:LobbyTableSummary[])=>void;let second!:(v:LobbyTableSummary[])=>void;
 h.load.mockImplementationOnce(()=>new Promise(r=>{first=r;})).mockImplementationOnce(()=>new Promise(r=>{second=r;}));
 const {result}=renderHook(()=>useLobby());await waitFor(()=>expect(h.load).toHaveBeenCalledTimes(1));
 act(()=>{for(let i=0;i<100;i++)h.events.forEach(fn=>fn());});
 expect(h.load).toHaveBeenCalledTimes(1);
 await act(async()=>first([table]));
 expect(h.load).toHaveBeenCalledTimes(2);expect(result.current.tables).toEqual([table]);
 await act(async()=>second([{...table,seatedCount:3}]));
 expect(result.current.tables[0].seatedCount).toBe(3);expect(result.current.loading).toBe(false);
});
it('bounds a hung read and aborts its transport rather than leaving loading forever',async()=>{
 vi.useFakeTimers();h.load.mockImplementation(()=>new Promise(()=>{}));
 const {result}=renderHook(()=>useLobby());
 await act(async()=>vi.advanceTimersByTimeAsync(10001));
 expect(result.current.loading).toBe(false);expect(result.current.error).toBe('lobby_read_timeout');
 expect((h.load.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
});
it('aborts on unmount and ignores a late result',async()=>{
 let resolve!:(v:LobbyTableSummary[])=>void;h.load.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=renderHook(()=>useLobby());await waitFor(()=>expect(h.load).toHaveBeenCalledTimes(1));
 const signal=h.load.mock.calls[0][0] as AbortSignal;view.unmount();
 expect(signal.aborted).toBe(true);await act(async()=>resolve([table]));expect(h.remove).toHaveBeenCalledTimes(1);
});
