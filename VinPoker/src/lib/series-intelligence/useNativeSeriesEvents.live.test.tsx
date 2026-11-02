import { act,cleanup,renderHook } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'owner-test'},loading:false,session:{access_token:'TEST_SERIES_SESSION_A'}}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
import {useNativeSeriesEvents} from './useNativeSeriesEvents';
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();f.auth={user:{id:'owner-test'},loading:false,session:{access_token:'TEST_SERIES_SESSION_A'}};});
it('does not turn a null RPC payload into a verified empty inventory',async()=>{
 f.rpc.mockResolvedValue({data:null,error:null});
 const view=renderHook(()=>useNativeSeriesEvents({clubId:'club-test'}));
 await act(async()=>{});
 expect(view.result.current.status).toBe('unavailable');expect(view.result.current.summary).toBeNull();
});
it('reads again while open and stops after leaving',async()=>{
 vi.useFakeTimers();f.rpc.mockResolvedValue({data:[],error:null});
 const view=renderHook(()=>useNativeSeriesEvents({clubId:'club-test'}));
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(f.rpc).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(f.rpc).toHaveBeenCalledTimes(2);
 expect(view.result.current.status).toBe('ready');
 view.unmount();await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(f.rpc).toHaveBeenCalledTimes(2);
});
it('hides the old inventory during auth loading',async()=>{
 f.rpc.mockResolvedValue({data:[],error:null});
 const view=renderHook(()=>useNativeSeriesEvents({clubId:'club-test'}));await act(async()=>{});
 expect(view.result.current.status).toBe('ready');
 f.auth={...f.auth,loading:true};view.rerender();
 expect(view.result.current.status).toBe('loading');expect(view.result.current.summary).toBeNull();
});

const row=()=>({event_id:'event-test',event_name:'TEST',event_date:'2026-10-31T10:00:00+07:00',
 buy_in:100000,fee:10000,service_fee:5000,gtd:null,prize_pool_actual:100000,total_entries:1,unique_entries:1,reentries:0,club_id:'club-test'});
it.each([
 ['foreign club',()=>[{...row(),club_id:'club-other'}]],
 ['missing identity',()=>[{...row(),event_id:null}]],
 ['invalid money',()=>[{...row(),fee:NaN}]],
 ['fractional count',()=>[{...row(),total_entries:1.5}]],
 ['duplicate event',()=>[row(),row()]],
] as const)('rejects %s rather than presenting verified event totals',async(_label,payload)=>{
 f.rpc.mockResolvedValue({data:payload(),error:null});const view=renderHook(()=>useNativeSeriesEvents({clubId:'club-test'}));
 await act(async()=>{});expect(view.result.current.status).toBe('unavailable');expect(view.result.current.summary).toBeNull();
});
it('hides and supersedes a prior session read for the same owner and club',async()=>{
 f.rpc.mockResolvedValueOnce({data:[row()],error:null}).mockReturnValueOnce(new Promise(()=>{}));
 const view=renderHook(()=>useNativeSeriesEvents({clubId:'club-test'}));await act(async()=>{});expect(view.result.current.status).toBe('ready');
 f.auth={...f.auth,session:{access_token:'TEST_SERIES_SESSION_B'}};view.rerender();
 expect(view.result.current.status).toBe('loading');expect(view.result.current.events).toEqual([]);
 await act(async()=>{});expect(f.rpc).toHaveBeenCalledTimes(2);
});