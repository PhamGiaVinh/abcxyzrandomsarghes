import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
type Listener=(event:string,session:{user:{id:string}}|null)=>void;
const h=vi.hoisted(()=>({listeners:[] as Listener[],holes:vi.fn(),load:vi.fn(),getUser:vi.fn(),meta:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:()=>h.getUser(),onAuthStateChange:(fn:Listener)=>{
 h.listeners.push(fn);return {data:{subscription:{unsubscribe:()=>{h.listeners=h.listeners.filter(v=>v!==fn);}}}};
}},channel:()=>{const q={on:()=>q,subscribe:()=>q};return q;},removeChannel:vi.fn(),rpc:vi.fn(async()=>({data:null,error:null}))}}));
vi.mock('@/lib/onlinePoker/types',async original=>({...await original<typeof import('@/lib/onlinePoker/types')>(),RUNTIME_LIVE:true}));
vi.mock('@/lib/pokerLiveSound',()=>({playPokerLiveSound:vi.fn()}));
vi.mock('@/lib/onlinePoker/client',()=>({listTablesLive:vi.fn(),loadHandStateLive:(...args:unknown[])=>h.load(...args),loadTableMetaLive:(...args:unknown[])=>h.meta(...args),loadTableHostLive:async()=>null,
 loadSeatsLive:async()=>[],loadLegalActionsLive:async()=>null,
 onlinePokerClient:{getMyHoleCards:()=>h.holes(),ping:async()=>({outcome:'ok'})},
 wirePublicToView:(wire:{config:{handId:string;handNo:number;tableId?:string}},priv?:{mySeat:number;myHoleCards:string[]})=>({handId:wire.config.handId,tableId:wire.config.tableId??'table-a',handNo:wire.config.handNo,status:'betting',street:'preflop',board:[],pot:'0',seats:[],toActSeat:null,buttonSeat:1,mySeat:priv?.mySeat,myHoleCards:priv?.myHoleCards}),
}));
import {useTableHand,useTableMeta} from '@/lib/onlinePoker/useOnlinePoker';
beforeEach(()=>{h.listeners=[];vi.clearAllMocks();h.getUser.mockResolvedValue({data:{user:{id:'actor-a'}},error:null});
 h.load.mockResolvedValue({wire:{config:{handId:'hand-a',handNo:1}},stateVersion:1});h.holes.mockResolvedValue({outcome:'ok',seat:1,cards:['As','Ah']});h.meta.mockResolvedValue({id:'table-a',name:'TABLE A',status:'open'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it.each(['switch','roundtrip'])('does not expose old table metadata during a new generation read (%s)',async change=>{
 const {result,rerender}=renderHook(({id})=>useTableMeta(id),{initialProps:{id:'table-a'}});
 await waitFor(()=>expect(result.current?.name).toBe('TABLE A'));h.meta.mockImplementation(()=>new Promise(()=>{}));
 rerender({id:'table-b'});if(change==='roundtrip')rerender({id:'table-a'});
 expect(result.current).toBeNull();
});
it('aborts a hung metadata read after the shared read deadline',async()=>{
 vi.useFakeTimers();h.meta.mockImplementation(()=>new Promise(()=>{}));const {result}=renderHook(()=>useTableMeta('table-a'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(result.current).toBeNull();
 expect(h.meta).toHaveBeenCalledTimes(1);expect((h.meta.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
});
it('refuses metadata for a different table even if the read resolves successfully',async()=>{
 h.meta.mockResolvedValue({id:'wrong-table',name:'WRONG',status:'open'});const {result}=renderHook(()=>useTableMeta('table-a'));
 await act(async()=>{});expect(result.current).toBeNull();
});
it('accepts a five-second hand read without every three-second poll superseding it',async()=>{
 vi.useFakeTimers();h.load.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({wire:{config:{handId:'hand-a',handNo:1}},stateVersion:1}),5000)));
 const {result}=renderHook(()=>useTableHand('table-a'));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 const initial=h.load.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(3001);});
 expect(h.load.mock.calls.length).toBe(initial);
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(result.current.hand?.handId).toBe('hand-a');
});
it('ends a hung hand read with explicit error and aborts its read transport',async()=>{
 vi.useFakeTimers();h.load.mockImplementation(()=>new Promise(()=>{}));
 const {result}=renderHook(()=>useTableHand('table-a'));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 for(const elapsed of [3000,3000,3000,1001])await act(async()=>{await vi.advanceTimersByTimeAsync(elapsed);});
 expect(result.current.loading).toBe(false);expect(result.current.error).not.toBeNull();
 expect(h.load.mock.calls.some(([,signal])=>(signal as AbortSignal)?.aborted)).toBe(true);
});
it.each(['switch','roundtrip'])('hides the previous table hand while the new generation read is pending (%s)',async(change)=>{
 const {result,rerender}=renderHook(({id})=>useTableHand(id),{initialProps:{id:'table-a'}});
 await waitFor(()=>expect(result.current.hand?.myHoleCards).toEqual(['As','Ah']));
 h.load.mockImplementation(()=>new Promise(()=>{}));await act(async()=>rerender({id:'table-b'}));
 if(change==='roundtrip')await act(async()=>rerender({id:'table-a'}));
 expect(result.current.hand).toBeNull();expect(result.current.legal).toBeNull();
});
it('rejects a table A fast-path callback after table B was loaded',async()=>{
 const {result,rerender}=renderHook(({id})=>useTableHand(id),{initialProps:{id:'table-a'}});
 await waitFor(()=>expect(result.current.hand?.myHoleCards).toEqual(['As','Ah']));const oldApply=result.current.applyServerView;
 h.load.mockResolvedValue({wire:{config:{tableId:'table-b',handId:'hand-b',handNo:1}},stateVersion:1});h.holes.mockResolvedValue({outcome:'not_seated'});
 rerender({id:'table-b'});await waitFor(()=>expect(result.current.hand?.tableId).toBe('table-b'));
 act(()=>oldApply({config:{tableId:'table-a',handId:'hand-a',handNo:1},mySeat:1,myHoleCards:['As','Ah']} as Parameters<typeof oldApply>[0],99));
 expect(result.current.hand?.tableId).toBe('table-b');expect(result.current.hand?.myHoleCards).not.toEqual(['As','Ah']);
});
it('removes actor A private cards after sign-out without waiting for the next hand',async()=>{
 const {result}=renderHook(()=>useTableHand('table-a'));
 await waitFor(()=>expect(result.current.hand?.myHoleCards).toEqual(['As','Ah']));
 h.holes.mockResolvedValue({outcome:'unauthenticated'});
 await act(async()=>{h.listeners.forEach(fn=>fn('SIGNED_OUT',null));});
 expect(result.current.hand?.myHoleCards).not.toEqual(['As','Ah']);expect(result.current.myUserId).toBeNull();
});
it('rejects a private fast-path callback captured before logout',async()=>{
 const {result}=renderHook(()=>useTableHand('table-a'));await waitFor(()=>expect(result.current.hand?.myHoleCards).toEqual(['As','Ah']));
 const oldApply=result.current.applyServerView;h.holes.mockResolvedValue({outcome:'unauthenticated'});
 await act(async()=>{h.listeners.forEach(fn=>fn('SIGNED_OUT',null));});
 act(()=>oldApply({config:{handId:'hand-a',handNo:1},mySeat:1,myHoleCards:['As','Ah']} as Parameters<typeof oldApply>[0],99));
 expect(result.current.hand?.myHoleCards).not.toEqual(['As','Ah']);
});
it('does not let a delayed initial getUser overwrite a newer auth event',async()=>{
 let finish!:(v:unknown)=>void;h.getUser.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));h.holes.mockResolvedValue({outcome:'not_seated'});
 const {result}=renderHook(()=>useTableHand('table-a'));
 await act(async()=>{h.listeners.forEach(fn=>fn('SIGNED_IN',{user:{id:'actor-b'}}));});
 await act(async()=>finish({data:{user:{id:'actor-a'}},error:null}));expect(result.current.myUserId).toBe('actor-b');
});
it('does not cache a delayed old-user hole response after switching accounts',async()=>{
 let finish!:(v:unknown)=>void;h.holes.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>useTableHand('table-a'));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 h.holes.mockResolvedValue({outcome:'not_seated'});
 act(()=>{h.listeners.forEach(fn=>fn('SIGNED_IN',{user:{id:'actor-b'}}));});
 await act(async()=>finish({outcome:'ok',seat:1,cards:['As','Ah']}));
 act(()=>result.current.refresh());await act(async()=>{});
 expect(result.current.hand?.myHoleCards).not.toEqual(['As','Ah']);expect(result.current.myUserId).toBe('actor-b');
});
