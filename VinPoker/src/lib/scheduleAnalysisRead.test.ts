import {afterEach,expect,it,vi} from 'vitest';
import {observeScheduleAnalysis} from './scheduleAnalysisRead';
afterEach(()=>vi.useRealTimers());
it('bounds a stalled file-conversion phase and clears the timer',async()=>{
 vi.useFakeTimers();let signal!:AbortSignal;
 const pending=observeScheduleAnalysis(new AbortController().signal,async s=>{signal=s;return new Promise(()=>{});});
 const rejected=expect(pending).rejects.toThrow('quá thời gian chờ');
 await vi.advanceTimersByTimeAsync(60_000);await rejected;
 expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('does not start file conversion for a cancelled analysis',async()=>{
 vi.useFakeTimers();const parent=new AbortController();parent.abort();const read=vi.fn();
 await expect(observeScheduleAnalysis(parent.signal,read)).rejects.toThrow('SCHEDULE_ANALYSIS_CANCELLED');
 expect(read).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('clears deadline and cancellation listener after success',async()=>{
 vi.useFakeTimers();const parent=new AbortController();let child!:AbortSignal;
 await expect(observeScheduleAnalysis(parent.signal,async s=>{child=s;return 7;})).resolves.toBe(7);
 expect(vi.getTimerCount()).toBe(0);parent.abort();expect(child.aborted).toBe(false);
});
it('cancels a pending conversion even when its transport ignores abort',async()=>{
 vi.useFakeTimers();const parent=new AbortController();let child!:AbortSignal;
 const pending=observeScheduleAnalysis(parent.signal,async s=>{child=s;return new Promise(()=>{});});
 await Promise.resolve();parent.abort();await expect(pending).rejects.toThrow('SCHEDULE_ANALYSIS_CANCELLED');
 expect(child.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
