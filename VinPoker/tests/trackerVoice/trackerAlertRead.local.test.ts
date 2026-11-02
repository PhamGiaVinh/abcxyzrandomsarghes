import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readTrackerAlertCounts} from './trackerBrowserEdge.local.mjs';

const tour='11111111-1111-4111-8111-111111111111';
const makeUrl=()=>new URL(`http://127.0.0.1:54329/rest/v1/tracker_floor_alerts?select=physical_table_id&tournament_id=eq.${tour}&status=in.(open,acknowledged,in_progress)`);
beforeEach(()=>vi.stubEnv('VINPOKER_NATIVE_BROWSER','1'));
afterEach(()=>vi.unstubAllEnvs());

it('executes the actual alert-count projection without manufacturing empty success',()=>{
 const rows=[{physical_table_id:'22222222-2222-4222-8222-222222222222'}];
 const query=vi.fn(()=>rows);
 expect(readTrackerAlertCounts({url:makeUrl(),fixture:{tour},query})).toBe(rows);
 expect(query).toHaveBeenCalledTimes(1);
 expect(query.mock.calls[0][0]).toContain(`tournament_id='${tour}'`);
 expect(query.mock.calls[0][0]).toContain("status IN ('open','acknowledged','in_progress')");
 expect(query.mock.calls[0][0]).toContain('SELECT physical_table_id FROM public.tracker_floor_alerts');
});

it.each(['tournament_id','select','status','extra'])('rejects an unexpected %s contract before SQL',key=>{
 const url=makeUrl();url.searchParams.set(key,'unexpected');const query=vi.fn();
 expect(()=>readTrackerAlertCounts({url,fixture:{tour},query})).toThrow();
 expect(query).not.toHaveBeenCalled();
});

it('preserves database denial instead of returning an empty count',()=>{
 const error=new Error('LOCAL_RLS_DENIED');
 expect(()=>readTrackerAlertCounts({url:makeUrl(),fixture:{tour},query:()=>{throw error;}})).toThrow(error);
});

it('cannot be used without the explicit local browser opt-in',()=>{
 vi.stubEnv('VINPOKER_NATIVE_BROWSER','0');const query=vi.fn();
 expect(()=>readTrackerAlertCounts({url:makeUrl(),fixture:{tour},query})).toThrow();
 expect(query).not.toHaveBeenCalled();
});
