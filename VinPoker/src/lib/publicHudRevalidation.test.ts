import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {revalidatePublicHudRead} from './publicHudRevalidation';
const blocked={access:'public',state:'unavailable'};
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(0);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('clears once for a safe barrier, recovers, and makes no further reads',async()=>{
 const read=vi.fn().mockResolvedValueOnce(blocked).mockResolvedValueOnce(blocked).mockResolvedValue({access:'public',state:'current',revision:'new'});
 const clear=vi.fn(),result=revalidatePublicHudRead(read,new AbortController().signal,clear);
 await vi.advanceTimersByTimeAsync(0);expect(clear).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(750);expect(await result).toMatchObject({revision:'new'});
 expect(read).toHaveBeenCalledTimes(3);expect(clear).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(3);expect(vi.getTimerCount()).toBe(0);
});
it('does not retry successful, warming or revoked responses',async()=>{
 for(const value of [{access:'public',state:'current'},{access:'public',state:'updating'},{access:'public',state:'warming'},{access:'revoked'}]){
  const read=vi.fn().mockResolvedValue(value);expect(await revalidatePublicHudRead(read,new AbortController().signal)).toBe(value);
  await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(1);
 }
 expect(vi.getTimerCount()).toBe(0);
});
it('rejects malformed preparation containing stale metrics instead of hiding it',async()=>{
 const read=vi.fn().mockResolvedValue({...blocked,counters:{publicHands:100}}),clear=vi.fn();
 await expect(revalidatePublicHudRead(read,new AbortController().signal,clear)).rejects.toThrow('PUBLIC_HUD_INVALID_PREPARATION');
 expect(read).toHaveBeenCalledTimes(1);expect(clear).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('stops an unresolved preparation at the total five-second budget',async()=>{
 const read=vi.fn().mockResolvedValue(blocked);
 const pending=revalidatePublicHudRead(read,new AbortController().signal).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(5000);const error=await pending;
 expect(error).toMatchObject({message:'PUBLIC_HUD_PREPARING',publicHudRevalidationExpired:true});
 expect(error).not.toHaveProperty('publicHudCallerCancelled');const calls=read.mock.calls.length;
 await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(calls);expect(vi.getTimerCount()).toBe(0);
});
it('bounds preparation traffic per withdrawn HUD without extending its budget',async()=>{
 const read=vi.fn().mockResolvedValue(blocked);
 const pending=revalidatePublicHudRead(read,new AbortController().signal).then(()=>null,error=>error);
 await vi.advanceTimersByTimeAsync(5000);
 const error=await pending;
 // Minimum jitter is the most aggressive permitted retry schedule. A constant
 // 250ms loop makes 20 calls per viewer here; bounded backoff permits seven.
 expect(read.mock.calls.length).toBeLessThanOrEqual(7);
 expect(error.publicHudRevalidationExpired).toBe(true);
 const calls=read.mock.calls.length;
 await vi.advanceTimersByTimeAsync(60000);
 expect(read).toHaveBeenCalledTimes(calls);
 expect(vi.getTimerCount()).toBe(0);
});
it('accepts a newly prepared revision after a longer jittered wait and then stays frozen',async()=>{
 vi.mocked(Math.random).mockReturnValue(0.999);
 const read=vi.fn().mockResolvedValue(blocked);
 const pending=revalidatePublicHudRead(read,new AbortController().signal);
 await vi.advanceTimersByTimeAsync(1500);
 read.mockResolvedValue({access:'public',state:'current',revision:'ready'});
 await vi.advanceTimersByTimeAsync(2000);
 expect(await pending).toMatchObject({revision:'ready'});
 const calls=read.mock.calls.length;
 await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(calls);
 expect(vi.getTimerCount()).toBe(0);
});
it('aborts a request at the overall budget and retains deadline priority over a late close',async()=>{
 const caller=new AbortController();
 const read=vi.fn((signal:AbortSignal)=>new Promise<Record<string,unknown>>((_resolve,reject)=>signal.addEventListener('abort',()=>{
  caller.abort();reject(Object.assign(Error('aborted'),{publicHudCallerCancelled:true}));
 },{once:true})));
 const pending=revalidatePublicHudRead(read,caller.signal).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(5000);const error=await pending;
 expect(error).toMatchObject({message:'PUBLIC_HUD_UNAVAILABLE',publicHudDeadline:true});expect(error).not.toHaveProperty('publicHudCallerCancelled');expect(read).toHaveBeenCalledTimes(1);
 expect(vi.getTimerCount()).toBe(0);
});
it('preserves HTTP/network/validation failure when a caller aborts late and never retries it',async()=>{
 for(const message of ['HTTP_FAILED_RESPONSE','PUBLIC_HUD_UNAVAILABLE','PUBLIC_HUD_INVALID_COUNTERS']){
  const caller=new AbortController(),failure=Error(message);
  const read=vi.fn(async()=>{caller.abort();throw failure;});
  await expect(revalidatePublicHudRead(read,caller.signal)).rejects.toBe(failure);
  expect(failure).not.toHaveProperty('publicHudCallerCancelled');expect(read).toHaveBeenCalledTimes(1);
 }
 expect(vi.getTimerCount()).toBe(0);
});
it('cancels a preparation wait immediately on close and never calls the next reader',async()=>{
 const caller=new AbortController(),read=vi.fn().mockResolvedValue(blocked);
 const pending=revalidatePublicHudRead(read,caller.signal).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(0);caller.abort();
 expect(await pending).toMatchObject({publicHudCallerCancelled:true});
 await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('makes no request after closure and does not accept a late successful response',async()=>{
 const closed=new AbortController();closed.abort();const unused=vi.fn();
 await expect(revalidatePublicHudRead(unused,closed.signal)).rejects.toMatchObject({publicHudCallerCancelled:true});expect(unused).not.toHaveBeenCalled();
 const caller=new AbortController();const read=vi.fn(async()=>{caller.abort();return {access:'public',state:'current'};});
 await expect(revalidatePublicHudRead(read,caller.signal)).rejects.toMatchObject({publicHudCallerCancelled:true});expect(vi.getTimerCount()).toBe(0);
});
