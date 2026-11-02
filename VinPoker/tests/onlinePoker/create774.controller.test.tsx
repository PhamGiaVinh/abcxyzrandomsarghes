import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {onlineCreateJournalKey,readOnlineCreateJournal} from '@/lib/onlinePoker/createJournal';
const h=vi.hoisted(()=>({create:vi.fn(),read:vi.fn(),settled:vi.fn()}));
vi.mock('@/lib/onlinePoker/client',()=>({onlinePokerClient:{createOpenTableWithRequest:h.create,getCreateReceipt:h.read}}));
import {useOnlineCreateIntent} from '@/hooks/useOnlineCreateIntent';
const actor='63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43',backend='http://127.0.0.1:54329';
const payload={name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9};
const receipt=(key:string)=>({outcome:'ok',request_id:key,replayed:false,table_id:'e217f4bd-d708-4ea5-93c3-f64371a8afff',seat_no:1});
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();let n=1;
 vi.stubGlobal('crypto',{randomUUID:()=>`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:string,work:()=>unknown)=>work())}});
 h.create.mockImplementation(async(_payload:unknown,key:string)=>receipt(key));
 h.read.mockImplementation(async(_payload:unknown,key:string)=>({state:'resolved',receipt:receipt(key)}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const mount=()=>renderHook(()=>useOnlineCreateIntent(actor,backend,h.settled));
it('persists the complete intent before dispatch and requires matching read proof before clearing',async()=>{
 h.create.mockImplementation(async(p:unknown,key:string)=>{
  expect(readOnlineCreateJournal(localStorage,actor,backend).intent).toMatchObject({requestId:key,payload:p});return receipt(key);
 });
 const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});
 expect(h.create).toHaveBeenCalledTimes(1);expect(h.read).toHaveBeenCalledTimes(1);expect(h.settled).toHaveBeenCalledTimes(1);
 expect(readOnlineCreateJournal(localStorage,actor,backend).intent).toBeNull();
});
it('retains unknown commit over remount without automatic mutation; recovery is read-only',async()=>{
 h.create.mockRejectedValue(Error('LOCAL503'));h.read.mockRejectedValue(Error('LOCAL503'));
 const first=mount();await waitFor(()=>expect(first.result.current.blocked).toBe(false));
 await act(async()=>{await first.result.current.submit(payload);});const frozen=first.result.current.pending;expect(frozen).not.toBeNull();first.unmount();
 h.create.mockClear();h.read.mockClear();const second=mount();await waitFor(()=>expect(second.result.current.pending).toEqual(frozen));
 expect(h.create).not.toHaveBeenCalled();expect(h.read).not.toHaveBeenCalled();
 await act(async()=>{await second.result.current.submit({...payload,name:'NEW'});});expect(h.create).not.toHaveBeenCalled();
 h.read.mockImplementation(async(_p:unknown,key:string)=>({state:'resolved',receipt:receipt(key)}));
 await act(async()=>{await second.result.current.recover();});expect(h.create).not.toHaveBeenCalled();expect(h.settled).toHaveBeenCalledTimes(1);
});
it('checks absence before explicit retry and preserves exact key/payload',async()=>{
 h.create.mockRejectedValueOnce(Error('LOCAL503'));h.read.mockResolvedValue({state:'missing'});
 const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});const first=h.create.mock.calls[0];
 h.create.mockClear();await act(async()=>{await view.result.current.recover();});expect(h.create).not.toHaveBeenCalled();
 h.read.mockResolvedValueOnce({state:'missing'}).mockImplementation(async(_p:unknown,key:string)=>({state:'resolved',receipt:receipt(key)}));
 await act(async()=>{await view.result.current.retry();});expect(h.create.mock.calls[0]).toEqual(first);expect(h.settled).toHaveBeenCalledTimes(1);
});
it('does not dispatch when storage silently fails',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
 const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});expect(h.create).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
});
it('does not treat a successful write alone as resolution',async()=>{
 h.read.mockRejectedValue(Error('LOCAL_READ503'));const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});expect(view.result.current.pending).not.toBeNull();expect(h.settled).not.toHaveBeenCalled();
});
it('ignores completion after the scope-keyed parent unmounts',async()=>{
 let finish!:(value:unknown)=>void;h.create.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));let work:unknown;
 act(()=>{work=view.result.current.submit(payload);});await waitFor(()=>expect(h.create).toHaveBeenCalled());view.unmount();
 await act(async()=>{finish(receipt(h.create.mock.calls[0][1]));await work;});expect(h.read).not.toHaveBeenCalled();expect(h.settled).not.toHaveBeenCalled();
 expect(readOnlineCreateJournal(localStorage,actor,backend).intent).not.toBeNull();
});
it('bounds a hung mutation, leaves its key, and allows no late auto-settlement',async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;h.create.mockImplementation(()=>new Promise(r=>{finish=r;}));h.read.mockRejectedValue(Error('READ503'));
 const view=mount();let work:unknown;act(()=>{work=view.result.current.submit(payload);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await work;});
 expect(view.result.current.busy).toBe(false);expect(view.result.current.pending).not.toBeNull();expect(h.settled).not.toHaveBeenCalled();
 await act(async()=>finish(receipt(h.create.mock.calls[0][1])));expect(h.settled).not.toHaveBeenCalled();
});
it('keeps the original intent read-only after another tab replaces the shared slot',async()=>{
 h.create.mockRejectedValue(Error('503'));h.read.mockRejectedValue(Error('503'));const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});const frozen=view.result.current.pending!;
 const newer={...frozen,requestId:'143bf437-a03e-40c3-83b7-b363dc64b198'};
 localStorage.setItem(onlineCreateJournalKey(actor,backend),JSON.stringify(newer));act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
 expect(view.result.current.pending).toEqual(frozen);expect(view.result.current.readOnlyRecovery).toBe(true);h.create.mockClear();
 await act(async()=>{await view.result.current.retry();});expect(h.create).not.toHaveBeenCalled();
 h.read.mockImplementation(async(_p:unknown,key:string)=>({state:'resolved',receipt:receipt(key)}));
 await act(async()=>{await view.result.current.recover();});expect(readOnlineCreateJournal(localStorage,actor,backend).intent).toEqual(newer);
});
it('treats a same-key payload replacement as read-only, not a retryable owned slot',async()=>{
 h.create.mockRejectedValue(Error('503'));h.read.mockRejectedValue(Error('503'));const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});const frozen=view.result.current.pending!;
 localStorage.setItem(onlineCreateJournalKey(actor,backend),JSON.stringify({...frozen,payload:{...payload,buyin:'6000'}}));
 act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));expect(view.result.current.readOnlyRecovery).toBe(true);
 h.create.mockClear();await act(async()=>{await view.result.current.retry();});expect(h.create).not.toHaveBeenCalled();
});
it('coordinates two mounted instances under the same actor/backend Web Lock',async()=>{
 let tail:Promise<unknown>=Promise.resolve();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn((_key:string,work:()=>unknown)=>{
  const result=tail.then(work);tail=result.catch(()=>{});return result;
 })}});
 let fail!:(e:Error)=>void;h.create.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));h.read.mockRejectedValue(Error('READ503'));
 const first=mount(),second=mount();await waitFor(()=>expect(first.result.current.blocked||second.result.current.blocked).toBe(false));
 let one:unknown,two:unknown;act(()=>{one=first.result.current.submit(payload);two=second.result.current.submit({...payload,name:'OTHER'});});
 await waitFor(()=>expect(h.create).toHaveBeenCalledTimes(1));await act(async()=>{fail(Error('COMMIT_UNKNOWN'));await one;await two;});
 expect(h.create).toHaveBeenCalledTimes(1);expect(second.result.current.pending).toEqual(first.result.current.pending);
});
it('blocks a second synchronous submit while the first is in flight',async()=>{
 let finish!:(v:unknown)=>void;h.create.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));let work:unknown;
 act(()=>{work=view.result.current.submit(payload);void view.result.current.submit(payload);});
 await waitFor(()=>expect(h.create).toHaveBeenCalledTimes(1));
 await act(async()=>{finish(receipt(h.create.mock.calls[0][1]));await work;});expect(h.settled).toHaveBeenCalledTimes(1);
});
it('rechecks ownership after a delayed missing-receipt read before retrying a write',async()=>{
 h.create.mockRejectedValue(Error('503'));h.read.mockRejectedValue(Error('503'));const view=mount();await waitFor(()=>expect(view.result.current.blocked).toBe(false));
 await act(async()=>{await view.result.current.submit(payload);});const frozen=view.result.current.pending!;h.create.mockClear();
 let finish!:(v:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce({state:'missing'});
 let work:unknown;act(()=>{work=view.result.current.retry();});await waitFor(()=>expect(finish).toBeTypeOf('function'));
 const newer={...frozen,requestId:'b10265f8-a18d-440b-8646-a25cc38f6712'};localStorage.setItem(onlineCreateJournalKey(actor,backend),JSON.stringify(newer));
 await act(async()=>{finish({state:'missing'});await work;});expect(h.create).not.toHaveBeenCalled();
 expect(readOnlineCreateJournal(localStorage,actor,backend).intent).toEqual(newer);
});
