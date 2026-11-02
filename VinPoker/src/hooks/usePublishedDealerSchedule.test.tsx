import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return query;},
  then:(yes:never,no:never)=>Promise.resolve(h.read(table)).then(yes,no)};
 return query;
}}}));
import {usePublishedDealerSchedule} from './usePublishedDealerSchedule';
const today='2026-10-21',tomorrow='2026-10-22';
const first={id:'assignment-today',run_id:'run-today',dealer_id:'dealer',work_date:today,
 scheduled_start_at:'2026-10-21T03:00:00Z',scheduled_end_at:'2026-10-21T15:00:00Z',status:'checked_in',checked_in_at:'2026-10-21T03:00:00Z'};
let attendance:Record<string,unknown>[];
let assignments:Record<string,unknown>[];
beforeEach(()=>{
 h.signals=[];
 attendance=[{dealer_id:'dealer',shift_date:today,check_in_time:'2026-10-21T03:00:00Z'}];
 assignments=[first,{...first,id:'assignment-tomorrow',run_id:'run-tomorrow',work_date:tomorrow,
  scheduled_start_at:'2026-10-22T03:00:00Z',scheduled_end_at:'2026-10-22T15:00:00Z',status:'published',checked_in_at:null}];
 h.read.mockImplementation((table:string)=>({error:null,data:table==='dealer_schedule_runs'
  ?[{id:'run-today',work_date:today,published_at:'2026-10-20T01:00:00Z'},{id:'run-tomorrow',work_date:tomorrow,published_at:'2026-10-20T01:00:00Z'}]
  :table==='dealer_shift_assignments'?assignments:table==='dealers'?[{id:'dealer',full_name:'TEST dealer'}]
  :table==='dealer_attendance'?attendance:[]}));
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});
it('ends a hung schedule read with an explicit retryable error and aborts its request',async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 h.read.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(result.current.loading).toBe(false);
 expect(result.current.error).toContain('Hết thời gian');
 expect(h.signals[0].aborted).toBe(true);
 await act(async()=>{resolve({data:[],error:null});});
 expect(result.current.error).toContain('Hết thời gian');
 expect(result.current.daysByDate).toEqual({});
});
it('can explicitly reload after the deadline without accepting the old response',async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 const normal=h.read.getMockImplementation()!;
 h.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 h.read.mockImplementation(normal);
 await act(async()=>{result.current.refetch();});
 expect(result.current.error).toBeNull();
 expect(result.current.daysByDate[today].assignments[0].state).toBe('in_pool');
 const accepted=result.current.daysByDate;
 await act(async()=>{resolve({data:[],error:null});});
 expect(result.current.daysByDate).toEqual(accepted);
});
it('cancels the old deadline when the club scope changes',async()=>{
 vi.useFakeTimers();const normal=h.read.getMockImplementation()!;
 h.read.mockImplementationOnce(()=>new Promise(()=>{}));
 const {result,rerender}=renderHook(({club})=>usePublishedDealerSchedule(club,[today]),{initialProps:{club:'old'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 h.read.mockImplementation(normal);
 await act(async()=>{rerender({club:'new'});});
 expect(result.current.error).toBeNull();
 expect(result.current.daysByDate[today].assignments[0].state).toBe('in_pool');
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(result.current.error).toBeNull();
 expect(result.current.loading).toBe(false);
});
it('does not attach today payroll start to a future published shift for the same dealer',async()=>{
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today,tomorrow]));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.daysByDate[today].assignments[0].payrollStartAt).toBe('2026-10-21T03:00:00Z');
 expect(result.current.daysByDate[tomorrow].assignments[0].payrollStartAt).toBeNull();
});
it('does not claim in_pool for a current assignment using a prior operating-day attendance',async()=>{
 attendance=[{...attendance[0],shift_date:'2026-10-20',check_in_time:'2026-10-20T03:00:00Z'}];
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.daysByDate[today].assignments[0].payrollStartAt).toBeNull();
 expect(result.current.daysByDate[today].assignments[0].state).toBe('waiting');
});
it('does not infer arrival from attendance when the assignment is only confirmed',async()=>{
 assignments=[{...first,status:'confirmed',checked_in_at:null}];
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.daysByDate[today].assignments[0].payrollStartAt).toBeNull();
 expect(result.current.daysByDate[today].assignments[0].state).toBe('confirmed');
});
it('does not choose an arbitrary open attendance when the operating-day evidence is ambiguous',async()=>{
 attendance.push({...attendance[0],check_in_time:'2026-10-21T04:00:00Z'});
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.daysByDate).toEqual({});
 expect(result.current.error).toContain('nhiều lượt check-in');
});
it('uses the operating date rather than the UTC calendar day for an overnight attendance',async()=>{
 assignments=[{...first,scheduled_start_at:'2026-10-21T15:00:00Z',scheduled_end_at:'2026-10-22T03:00:00Z',checked_in_at:'2026-10-21T19:00:00Z'}];
 attendance=[{...attendance[0],shift_date:today,check_in_time:'2026-10-21T19:00:00Z'}];
 const {result}=renderHook(()=>usePublishedDealerSchedule('club',[today]));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.error).toBeNull();
 expect(result.current.daysByDate[today].assignments[0].payrollStartAt).toBe('2026-10-21T19:00:00Z');
 expect(result.current.daysByDate[today].assignments[0].state).toBe('in_pool');
});
