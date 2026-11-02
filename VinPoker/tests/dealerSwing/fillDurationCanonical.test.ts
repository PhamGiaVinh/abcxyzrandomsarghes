import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/pickNextDealer.ts',()=>({pickNextDealerWithStatus:vi.fn(async()=>({status:'ok',candidate:{id:'attendance',full_name:'TEST',current_state:'available'}}))}));
import {fillEmptyTables} from '../../supabase/functions/_shared/fillEmptyTables.ts';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function adminFor({tournamentId='tour',tableType='tournament',override=null,failedRead=null,clubDuration=null}:{tournamentId?:string|null;tableType?:string;override?:number|null;failedRead?:string|null;clubDuration?:number|null}={}) {
 const rpc=vi.fn(async(name:string,_args?:Record<string,unknown>)=>name==='get_dealer_operational_tables_v1'?{data:[{
  id:'physical',table_session_id:'session',tournament_id:tournamentId,table_name:'TEST',table_type:tableType,
  shift_id:null,current_blind_level:1,opened_at:null,dealer_open_operation_id:null}],error:null}
  :{data:{outcome:'ok'},error:null});
 const selections:string[]=[];
 const from=(table:string)=>{const query={select:(columns:string)=>{selections.push(`${table}:${columns}`);return query;},eq:()=>query,is:()=>query,in:()=>query,
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:table===failedRead?{code:'503',message:'unavailable'}:null,
   data:table==='tournaments'?[{id:'tour',swing_duration_minutes:20,tournament_tables:[{table_id:null,game_table_id:'physical'}]}]
    :table==='swing_configs'&&override!==null?[{scope_id:'physical',swing_duration_minutes:override}]
    :table==='swing_config'&&clubDuration!==null?[{table_type:tableType,swing_duration_minutes:clubDuration}]:[]}).then(resolve)};return query;};
 return {rpc,from,selections};
}
describe('auto-fill duration follows exact session tournament',()=>{
 it.each([{tableType:'cash',clubDuration:35,override:null},{tableType:'vip',clubDuration:null,override:35}])('honors configured $tableType duration instead of caller fallback',async({tableType,clubDuration,override})=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
  const admin=adminFor({tournamentId:null,tableType,clubDuration,override});
  const result=await fillEmptyTables(admin as never,'club',undefined,'',undefined,'2026-10-18T09:30:00Z',15,true);
  expect(result.status).toBe('ok');
  expect(admin.rpc.mock.calls.find(([name])=>name==='worker_assign_dealer_to_session_v1')?.[1]?.p_swing_due_at).toBe('2026-10-18T09:35:00.000Z');
 });
 it.each([0,-1,1.5])('does not assign with invalid configured duration %s',async override=>{
  const admin=adminFor({override});
  const result=await fillEmptyTables(admin as never,'club',undefined,'',undefined,'2026-10-18T09:30:00Z',15,true);
  expect(result.status).toBe('degraded');expect(result.assignments).toEqual([]);
  expect(admin.rpc.mock.calls.some(([name])=>name==='worker_assign_dealer_to_session_v1')).toBe(false);
 });
 it('does not substitute a fallback when the exact operational tournament is missing',async()=>{
  const admin=adminFor({tournamentId:'another-tour'});
  const result=await fillEmptyTables(admin as never,'club',undefined,'',undefined,'2026-10-18T09:30:00Z',15,true);
  expect(result.status).toBe('degraded');expect(result.assignments).toEqual([]);
 });
 it.each([
  {tournamentId:'tour',tableType:'tournament',override:null,minutes:20},
  {tournamentId:null,tableType:'cash',override:null,minutes:30},
  {tournamentId:null,tableType:'vip',override:null,minutes:30},
  {tournamentId:'tour',tableType:'tournament',override:25,minutes:25},
 ])('uses scoped duration: $tableType/$tournamentId/override$override',async({tournamentId,tableType,override,minutes})=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const admin=adminFor({tournamentId,tableType,override});
  const result=await fillEmptyTables(admin as never,'club',undefined,'',undefined,'2026-10-18T09:30:00Z',15,true);
  expect(result.status).toBe('ok');expect(result.assignments).toHaveLength(1);
  const assignment=admin.rpc.mock.calls.find(([name])=>name==='worker_assign_dealer_to_session_v1');
  expect(assignment?.[1]?.p_table_session_id).toBe('session');
  expect(assignment?.[1]?.p_swing_due_at).toBe(`2026-10-18T09:${String(minutes).padStart(2,'0')}:00.000Z`);
  expect(admin.selections).toContain('tournaments:id, swing_duration_minutes');
 });
 it.each(['dealer_assignments','tournaments','swing_configs','swing_config'])('does not assign on failed %s read',async failedRead=>{
  const admin=adminFor({failedRead});
  const result=await fillEmptyTables(admin as never,'club',undefined,'',undefined,'2026-10-18T09:30:00Z',15,true);
  expect(result.status).toBe('query_failed');expect(result.assignments).toEqual([]);
  expect(admin.rpc.mock.calls.map(([name])=>name)).toEqual(['get_dealer_operational_tables_v1']);
 });
});
