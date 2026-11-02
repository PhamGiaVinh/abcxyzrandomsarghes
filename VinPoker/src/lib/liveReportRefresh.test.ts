import{afterEach,describe,expect,it,vi}from'vitest';import{startLiveReportRefresh}from'./liveReportRefresh';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('read-only report refresh lifecycle',()=>{
 it('coalesces concurrent refresh signals and never overlaps a pending read',async()=>{
  vi.useFakeTimers();let finish!:()=>void;const read=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;})).mockResolvedValue(undefined);const stop=startLiveReportRefresh(read);
  try{await vi.advanceTimersByTimeAsync(15000);window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));expect(read).toHaveBeenCalledTimes(1);finish();await Promise.resolve();await Promise.resolve();expect(read).toHaveBeenCalledTimes(2);}finally{stop();}
 });
 it('does not dispatch queued reads after unmount',async()=>{
  vi.useFakeTimers();let finish!:()=>void;const read=vi.fn(()=>new Promise<void>(r=>{finish=r;}));const stop=startLiveReportRefresh(read);await vi.advanceTimersByTimeAsync(5000);stop();finish();await Promise.resolve();window.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(1);
 });
 it('waits while hidden and promptly refreshes when visible again',async()=>{
  vi.useFakeTimers();let visibility='hidden';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility as DocumentVisibilityState);const read=vi.fn().mockResolvedValue(undefined);const stop=startLiveReportRefresh(read);
  try{await Promise.resolve();await vi.advanceTimersByTimeAsync(15000);expect(read).toHaveBeenCalledTimes(1);visibility='visible';document.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();expect(read).toHaveBeenCalledTimes(2);}finally{stop();}
 });
 it('refreshes an idle visible report when connectivity returns',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(undefined);const stop=startLiveReportRefresh(read);try{await Promise.resolve();window.dispatchEvent(new Event('online'));await Promise.resolve();expect(read).toHaveBeenCalledTimes(2);}finally{stop();}
 });
});
