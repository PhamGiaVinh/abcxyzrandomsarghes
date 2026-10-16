// Actual-source transport tests; not PostgreSQL or live Edge acceptance evidence.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';

const source=readFileSync(resolve(process.cwd(),'supabase/functions/process-swing/passes/passR-rotation-planner.ts'),'utf8');
const candidateSource=readFileSync(resolve(process.cwd(),'supabase/functions/_shared/pickNextDealer.ts'),'utf8');
const failureStart=candidateSource.indexOf('export class CandidateSnapshotFailure'),failureEnd=candidateSource.indexOf('function requireCandidateSnapshot',failureStart);
if(failureStart<0||failureEnd<=failureStart)throw Error('Actual candidate failure definitions missing');
const failureJs=ts.transpileModule(candidateSource.slice(failureStart,failureEnd).replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {CandidateSnapshotFailure,isCandidateSnapshotFailure}=new Function(`${failureJs};return {CandidateSnapshotFailure,isCandidateSnapshotFailure};`)();
const start=source.indexOf('async function fetchTournamentInfo(');
const end=source.indexOf('// ─── Phase A:',start);
if(start<0||end<=start)throw Error('Actual PassR tournament reader seam missing');
const js=ts.transpileModule(source.slice(start,end),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const read=new Function('console',`${js}; return fetchTournamentInfo;`)({warn:vi.fn()});

it('actual input readers distinguish dependency failure from a verified empty snapshot',async()=>{
 const first=source.indexOf('async function fetchActiveAssignments(');
 if(first<0||start<=first)throw Error('Actual input snapshot seams missing');
 const input=ts.transpileModule(source.slice(first,start),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const readers=new Function('console',`${input};return [fetchActiveAssignments,fetchLiveScheduleRows];`)({error:vi.fn()});
 for(const [index,reader] of readers.entries()){
  for(const response of [{data:null,error:{message:'synthetic outage'}},{data:null,error:null},{data:[],error:null}]){
   const query={select:vi.fn(),eq:vi.fn(),is:vi.fn(),in:vi.fn(),
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(response).then(resolve)};
   for(const key of ['select','eq','is','in'] as const)query[key].mockReturnValue(query);
   if(response.error||response.data===null){
    await expect(reader({from:()=>query},'club-a')).rejects.toThrow(index===0?
     'rotation_assignment_snapshot_unavailable':'rotation_schedule_snapshot_unavailable');
   }else{
    await expect(reader({from:()=>query},'club-a')).resolves.toEqual([]);
   }
  }
 }
});

const assignment={table_id:'physical-a',table_session_id:'session-new'};
it.each([{data:null,error:{message:'synthetic outage'}},{data:null,error:null}])('reconciliation does not cancel a real lock after failed dealer-state read: %j',async(response)=>{
 const first=source.indexOf('async function reconcileAndAdopt('),last=source.indexOf('// ─── Build solver inputs',first);
 const entry=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const reconcile=new Function('console',`${entry};return reconcileAndAdopt;`)({warn:vi.fn()});
 const rpc=vi.fn(async()=>({data:{outcome:'cancelled',schedule_id:'slot-a'},error:null}));
 const a={...assignment,id:'assignment-a',pre_assigned_attendance_id:'incoming-a',planned_relief_at:'2026-10-16T01:00:00Z'};
 const before={...a};const query={select:vi.fn(),in:vi.fn(async()=>response)};query.select.mockReturnValue(query);
 await expect(reconcile({from:()=>query,rpc},{clubId:'club-a'},[a],[{id:'slot-a',assignment_id:a.id,table_id:a.table_id,status:'announced',in_attendance_id:'incoming-a'}],'run-a')).rejects.toThrow('rotation_lock_dealer_snapshot_unavailable');
 expect(rpc).not.toHaveBeenCalled();expect(a).toEqual(before);
});
it.each([true,false])('reconciliation preserves a verified real lock or cancels verified missing dealer: present=%s',async(present)=>{
 const first=source.indexOf('async function reconcileAndAdopt('),last=source.indexOf('// ─── Build solver inputs',first);
 const entry=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const reconcile=new Function('console',`${entry};return reconcileAndAdopt;`)({warn:vi.fn()});
 const rpc=vi.fn(async()=>({data:{outcome:'cancelled',schedule_id:'slot-a'},error:null}));
 const a={...assignment,id:'assignment-a',pre_assigned_attendance_id:'incoming-a' as string|null,planned_relief_at:'2026-10-16T01:00:00Z' as string|null};
 const query={select:vi.fn(),in:vi.fn(async()=>({data:present?[{id:'incoming-a',current_state:'pre_assigned',status:'checked_in'}]:[],error:null}))};query.select.mockReturnValue(query);
 const result=await reconcile({from:()=>query,rpc},{clubId:'club-a'},[a],[{id:'slot-a',assignment_id:a.id,table_id:a.table_id,status:'announced',in_attendance_id:'incoming-a'}],'run-a');
 expect(result).toEqual({adopted:0,cancelled:present?0:1});expect(rpc).toHaveBeenCalledTimes(present?0:1);
 expect(a.pre_assigned_attendance_id).toBe(present?'incoming-a':null);
});
it.each(['adopted','already_adopted','transport','repair','wrong-version','invalid-time'] as const)('legacy adoption mirrors only exact atomic proof: %s',async(mode)=>{
 const first=source.indexOf('async function reconcileAndAdopt('),last=source.indexOf('// ─── Build solver inputs',first);
 const entry=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const reconcile=new Function('console',`${entry};return reconcileAndAdopt;`)({warn:vi.fn()});
 const a={...assignment,id:'assignment-a',version:7,pre_assigned_attendance_id:'incoming-a',planned_relief_at:null as string|null},before={...a};
 const proof={outcome:mode==='already_adopted'?'already_adopted':mode==='repair'?'repair_required':'adopted',club_id:'club-a',table_id:a.table_id,table_session_id:a.table_session_id,assignment_id:a.id,expected_version:mode==='wrong-version'?8:7,incoming_attendance_id:'incoming-a',schedule_id:'slot-a',planned_relief_at:mode==='invalid-time'?'bad-time':'2026-10-16T02:00:00Z'};
 const rpc=vi.fn(async()=>({data:mode==='transport'?null:proof,error:mode==='transport'?{message:'synthetic outage'}:null}));
 const q={select:vi.fn(),in:vi.fn(async()=>({data:[{id:'incoming-a',current_state:'pre_assigned',status:'checked_in'}],error:null}))};q.select.mockReturnValue(q);
 const promise=reconcile({from:(table:string)=>{expect(table).toBe('dealer_attendance');return q;},rpc},{clubId:'club-a'},[a],[],'run-a');
 if(mode==='adopted'||mode==='already_adopted'){await expect(promise).resolves.toEqual({adopted:mode==='adopted'?1:0,cancelled:0});expect(a.planned_relief_at).toBe(proof.planned_relief_at);}
 else{await expect(promise).rejects.toThrow('rotation_legacy_adoption_unverified');expect(a).toEqual(before);}
 expect(rpc).toHaveBeenCalledWith('worker_adopt_legacy_preassignment_v1',{p_club_id:'club-a',p_table_id:before.table_id,p_table_session_id:before.table_session_id,p_assignment_id:before.id,p_expected_version:7,p_incoming_attendance_id:'incoming-a',p_plan_run_id:'run-a'});
});
it.each([
 {data:null,error:{message:'synthetic cancel outage'}},
 {data:null,error:null},{data:{outcome:'error'},error:null},
 {data:{outcome:'noop'},error:null},{data:{outcome:'cancelled',schedule_id:'other-slot'},error:null},
])('does not clear its snapshot after unverified cancellation: %j',async(response)=>{
 const first=source.indexOf('async function reconcileAndAdopt('),last=source.indexOf('// ─── Build solver inputs',first);
 const entry=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const reconcile=new Function('console',`${entry};return reconcileAndAdopt;`)({warn:vi.fn()});
 const a={...assignment,id:'assignment-a',pre_assigned_attendance_id:'incoming-a',planned_relief_at:'2026-10-16T01:00:00Z'},before={...a};
 const query={select:vi.fn(),in:vi.fn(async()=>({data:[],error:null}))};query.select.mockReturnValue(query);
 const rpc=vi.fn(async()=>response);
 await expect(reconcile({from:()=>query,rpc},{clubId:'club-a'},[a],[{id:'slot-a',assignment_id:a.id,table_id:a.table_id,status:'announced',in_attendance_id:'incoming-a'}],'run-a')).rejects.toThrow('rotation_cancel_unverified');
 expect(a).toEqual(before);
});
it.each(['transport','repair','wrong-session','wrong-version','cleared'] as const)('legacy cleanup mirrors only exact atomic receipt: %s',async(mode)=>{
 const first=source.indexOf('async function reconcileAndAdopt('),last=source.indexOf('// ─── Build solver inputs',first);
 const entry=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const reconcile=new Function('console',`${entry};return reconcileAndAdopt;`)({warn:vi.fn()});
 const a={...assignment,id:'assignment-a',version:7,pre_assigned_attendance_id:'incoming-a' as string|null,planned_relief_at:'2026-10-16T01:00:00Z' as string|null},before={...a};
 const receipt={outcome:mode==='repair'?'repair_required':'cleared',club_id:'club-a',table_id:a.table_id,table_session_id:mode==='wrong-session'?'old-session':a.table_session_id,assignment_id:a.id,expected_version:mode==='wrong-version'?8:7,incoming_attendance_id:'incoming-a'};
 const rpc=vi.fn(async()=>({data:mode==='transport'?null:receipt,error:mode==='transport'?{message:'synthetic outage'}:null}));
 const query={select:vi.fn(),in:vi.fn(async()=>({data:[{id:'incoming-a',current_state:'pre_assigned',status:'checked_out'}],error:null}))};query.select.mockReturnValue(query);
 const result=reconcile({from:()=>query,rpc},{clubId:'club-a'},[a],[],'run-a');
 if(mode==='cleared'){await expect(result).resolves.toEqual({adopted:0,cancelled:1});expect(a.pre_assigned_attendance_id).toBeNull();}
 else{await expect(result).rejects.toThrow('rotation_legacy_cleanup_unverified');expect(a).toEqual(before);}
 expect(rpc).toHaveBeenCalledWith('worker_clear_legacy_preassignment_v1',{p_club_id:'club-a',p_table_id:before.table_id,p_table_session_id:before.table_session_id,p_assignment_id:before.id,p_expected_version:7,p_incoming_attendance_id:'incoming-a'});
});
it.each([
 {data:null,error:{message:'synthetic outage'}},
 {data:null,error:null}, {data:-1,error:null}, {data:NaN,error:null},
 {data:Infinity,error:null}, {data:'0',error:null},
 {data:0,error:null}, {data:1,error:null},
 {data:0,error:null,releaseError:true},
])('gates early-break release on verified supply and exposes failures: %j',async(response)=>{
 const entryStart=source.indexOf('export async function passRRotationPlanner(');
 const entryEnd=source.indexOf('// ─── replanSingleTable',entryStart);
 const entry=ts.transpileModule(source.slice(entryStart,entryEnd).replace('export async function','async function'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const rpc=vi.fn(async(name:string)=>name==='count_available_dealers'?response:{data:[],error:'releaseError' in response?{message:'synthetic release outage'}:null});
 const planner=new Function('fetchActiveAssignments','fetchLiveScheduleRows','fetchTournamentInfo','reconcileAndAdopt','markOvertime','buildRotationSupply','console','crypto','SWING_POLICY',`${entry};return passRRotationPlanner;`)(
  async()=>[{...assignment,attendance_id:'outgoing',swing_due_at:new Date(0).toISOString()}],async()=>[],
  async()=>({tournamentInfo:new Map(),rejectedTables:new Map()}),async()=>({adopted:0,cancelled:0}),async()=>0,
  async()=>({status:'query_failed',errorCode:'test_boundary_after_supply'}),{warn:vi.fn(),error:vi.fn()},
  {randomUUID:()=> 'run-test'},{rest:{executeMinRestFloorMinutes:15}},
 );
 const result=await planner({rpc},{clubId:'club-a',cycleExcludedIds:[],preAnnounceMinutes:3});
 const verified=!response.error&&typeof response.data==='number'&&Number.isInteger(response.data)&&response.data>=0;
 expect(rpc.mock.calls.map(call=>call[0])).toEqual(verified&&response.data===0?['count_available_dealers','end_breaks_on_demand']:['count_available_dealers']);
 if(!verified)expect(result.errors).toContainEqual({scope:'early_break_supply',error:'rotation_available_count_unverified'});
 else if('releaseError' in response)expect(result.errors).toContainEqual({scope:'early_break_release',error:'rotation_early_break_release_unavailable'});
 else expect(result.errors).toEqual([{scope:'candidate_snapshot',error:'test_boundary_after_supply'}]);
});
const session={id:'session-new',club_id:'club-a',game_table_id:'physical-a',
 tournament_id:'tour-new',session_type:'tournament',closed_at:null};
const link={id:'logical-a',table_id:null,game_table_id:'physical-a',table_session_id:'session-new',
 status:'active',tournament_id:'tour-new',tournaments:{id:'tour-new',club_id:'club-a',name:'Current TEST',buy_in:100}};
function client(rows:unknown[]=[link],sessions:unknown[]=[session],failedTable?:string){
 return {from:vi.fn((table:string)=>{
  let filtered=(table==='table_sessions'?sessions:rows) as Array<Record<string,unknown>>;
  const query={select:vi.fn(),eq:vi.fn(),in:vi.fn(async(field:string,ids:string[])=>({
   data:table===failedTable?null:filtered.filter(row=>ids.includes(row[field] as string)),
   error:table===failedTable?{message:'synthetic failure'}:null,
  }))};
  query.select.mockReturnValue(query);
  query.eq.mockImplementation((field:string,value:unknown)=>{
   filtered=filtered.filter(row=>field==='tournaments.club_id'
    ? (row.tournaments as Record<string,unknown>)?.club_id===value : row[field]===value);
   return query;
  });
  return query;
 })};
}
it('reads canonical active mapping and ignores closed historical links regardless of order',async()=>{
 const old={...link,id:'old',status:'closed',table_session_id:'session-old',tournaments:{...link.tournaments,id:'old',buy_in:999}};
 for(const rows of [[link,old],[old,link]]){
  const result=await read(client(rows),'club-a',[assignment]);
  expect(result.tournamentInfo.get('physical-a')).toEqual({tournamentId:'tour-new',tournamentName:'Current TEST',buyIn:100});
  expect(result.rejectedTables.size).toBe(0);
 }
});
it('throws on dependency failure instead of treating it as no mapping',async()=>{
 for(const table of ['table_sessions','tournament_tables'])
  await expect(read(client([link],[session],table),'club-a',[assignment])).rejects.toThrow('snapshot_unavailable');
});
it('rejects missing, stale, foreign and duplicate mapping/session contexts',async()=>{
 for(const [rows,sessions] of [
  [[],[session]], [[link,link],[session]], [[link],[{...session,closed_at:'2026-10-15'}]],
  [[link],[{...session,game_table_id:'other'}]], [[link],[{...session,club_id:'other'}]],
  [[{...link,table_id:'other'}],[session]], [[{...link,tournament_id:'other'}],[session]],
  [[{...link,tournaments:{...link.tournaments,club_id:'other'}}],[session]],
 ] as [unknown[],unknown[]][])
  expect((await read(client(rows,sessions),'club-a',[assignment])).rejectedTables.size).toBe(1);
 expect((await read(client(),'club-a',[{...assignment,table_session_id:null}])).rejectedTables.get('physical-a')).toBe('rotation_assignment_session_missing');
 expect((await read(client(),'club-a',[assignment,assignment])).rejectedTables.get('physical-a')).toBe('rotation_assignment_session_ambiguous');
});
it('allows a verified cash session to have no tournament mapping',async()=>{
 const result=await read(client([],[{...session,session_type:'cash',tournament_id:null}]),'club-a',[assignment]);
 expect(result.tournamentInfo.size).toBe(0);
 expect(result.rejectedTables.size).toBe(0);
});
it('actual planner rejects invalid mapping before reconciliation, OT or rest writes',async()=>{
 const entryStart=source.indexOf('export async function passRRotationPlanner(');
 const entryEnd=source.indexOf('// ─── replanSingleTable',entryStart);
 if(entryStart<0||entryEnd<=entryStart)throw Error('Actual planner entrypoint missing');
 const entry=ts.transpileModule(source.slice(entryStart,entryEnd).replace('export async function','async function'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const mutation=vi.fn(async()=>({adopted:0,cancelled:0}));
 const planner=new Function('fetchActiveAssignments','fetchLiveScheduleRows','fetchTournamentInfo',
  'reconcileAndAdopt','markOvertime','console','crypto',`${entry};return passRRotationPlanner;`)(
  async()=>[assignment],async()=>[],read,mutation,mutation,{error:vi.fn()}, {randomUUID:()=> 'run-test'},
 );
 const admin={...client([],[]),rpc:mutation};
 const result=await planner(admin,{clubId:'club-a'});
 expect(result.errors).toEqual([{scope:'table:physical-a',error:'rotation_assignment_session_invalid'}]);
 expect(mutation).not.toHaveBeenCalled();
 expect(result.planned).toBe(0);
});
it('actual emergency replanner validates before canceling slots or clearing preassignment',async()=>{
 const entryStart=source.indexOf('export async function replanSingleTable(');
 if(entryStart<0)throw Error('Actual emergency entrypoint missing');
 const entry=ts.transpileModule(source.slice(entryStart).replace('export async function','async function'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const replan=new Function('fetchTournamentInfo','isCandidateSnapshotFailure','CandidateSnapshotFailure',`${entry};return replanSingleTable;`)(read,isCandidateSnapshotFailure,CandidateSnapshotFailure);
 for(const failedTable of [undefined,'table_sessions','tournament_tables']){
  const mutation=vi.fn();
  const snapshot=client([],[],failedTable);
  const admin={rpc:mutation,from:vi.fn((table:string)=>{
   if(table!=='dealer_assignments'&&table!=='dealer_rotation_schedule')return snapshot.from(table);
   const query={select:vi.fn(),eq:vi.fn(),update:mutation,
    in:vi.fn(async()=>({data:[{id:'slot-a',status:'announced'}],error:null})),
    maybeSingle:vi.fn(async()=>({data:{...assignment,id:'assignment-a',status:'assigned',
     released_at:null,swing_processed_at:null,pre_assigned_attendance_id:'incoming-a'},error:null})),
   };
   query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
   return query;
  })};
  await expect(replan(admin,{clubId:'club-a'},'assignment-a',new Set(),'test')).rejects.toMatchObject({status:'query_failed',errorCode:'rotation_emergency_replan_unverified'});
  expect(mutation).not.toHaveBeenCalled();
 }
});
it.each(['schedule-error','schedule-null','assignment-error','cancel-error','cancel-noop','inactive','verified'] as const)('emergency replan handles snapshot/cancel state %s',async(mode)=>{
 const entryStart=source.indexOf('export async function replanSingleTable(');
 const entry=ts.transpileModule(source.slice(entryStart).replace('export async function','async function'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const replan=new Function('fetchTournamentInfo','isCandidateSnapshotFailure','buildRotationSupply','CandidateSnapshotFailure',`${entry};return replanSingleTable;`)(async()=>({tournamentInfo:new Map(),rejectedTables:new Map()}),isCandidateSnapshotFailure,async()=>{throw new Error('test_boundary_after_clear');},CandidateSnapshotFailure);
 const update=vi.fn();
 const rpc=vi.fn(async()=>mode==='cancel-error'?{data:null,error:{message:'synthetic outage'}}:{data:mode==='verified'?{outcome:'cancelled',schedule_id:'slot-a'}:{outcome:'noop'},error:null});
 const admin={rpc,from:vi.fn(()=>{
  const q={select:vi.fn(),eq:vi.fn(),update,
   in:vi.fn(async()=>({data:mode.startsWith('schedule-')?null:[{id:'slot-a',status:'announced'}],error:mode==='schedule-error'?{message:'synthetic outage'}:null})),
   maybeSingle:vi.fn(async()=>({data:mode==='assignment-error'||mode==='inactive'?null:{...assignment,id:'assignment-a',status:'assigned',released_at:null,swing_processed_at:null,pre_assigned_attendance_id:'incoming-a'},error:mode==='assignment-error'?{message:'synthetic outage'}:null})),
  };q.select.mockReturnValue(q);q.eq.mockReturnValue(q);update.mockReturnValue(q);return q;
 })};
 const result=replan(admin,{clubId:'club-a'},'assignment-a',new Set(),'test');
 if(mode==='inactive')await expect(result).resolves.toEqual({relocked:false,detail:'assignment_no_longer_active'});
 else await expect(result).rejects.toMatchObject({status:'query_failed',errorCode:'rotation_emergency_replan_unverified'});
 expect(update).toHaveBeenCalledTimes(mode==='verified'?1:0);
 expect(rpc).toHaveBeenCalledTimes(mode.startsWith('cancel-')||mode==='verified'?1:0);
});
it.each(['announce-error','locked-error','persist-error','persist-malformed','persist-rejected','pending','locked'] as const)('emergency dispatch distinguishes failure from business state: %s',async(mode)=>{
 const entryStart=source.indexOf('export async function replanSingleTable(');
 const entry=ts.transpileModule(source.slice(entryStart).replace('export async function','async function'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const a={...assignment,id:'assignment-a',status:'assigned',released_at:null,swing_processed_at:null,pre_assigned_attendance_id:null};
 const q={select:vi.fn(),eq:vi.fn(),in:vi.fn(async()=>({data:[],error:null})),maybeSingle:vi.fn(async()=>({data:a,error:null}))};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);
 const rpc=vi.fn(async()=>({data:mode==='persist-error'?null:{outcome:'ok',...(mode==='persist-malformed'?{rejected_table_ids:'bad'}:mode==='persist-rejected'?{rejected_table_ids:['physical-a']}:{})},error:mode==='persist-error'?{message:'synthetic outage'}:null}));
 const replan=new Function('fetchTournamentInfo','isCandidateSnapshotFailure','buildRotationSupply','getFeatureTablePoolsByTable','getReservedDealerIds','solveRotationPlan','buildSolverTables','rowToJson','crypto','SWING_POLICY','ANNOUNCE_LEAD_MS','SOLVER_VERSION','announceDueSlots','CandidateSnapshotFailure',`${entry};return replanSingleTable;`)(
  async()=>({tournamentInfo:new Map(),rejectedTables:new Map()}),isCandidateSnapshotFailure,async()=>({status:'ok',supply:[]}),async()=>new Map(),async()=>new Set(),()=>({rows:[{slotIndex:0,inAttendanceId:'incoming-a'}]}),()=>[],()=>({}),{randomUUID:()=> 'run-a'},{rest:{executeMinRestFloorMinutes:15}},180000,'test',async()=>({locked:mode==='locked'||mode==='locked-error'?1:0,errors:mode==='announce-error'||mode==='locked-error'?[{scope:'announce_query',error:'synthetic outage'}]:[]}),CandidateSnapshotFailure,
 );
 const result=replan({from:()=>q,rpc},{clubId:'club-a',minInterSwingRestMinutes:15},a.id,new Set(),'test');
 if(mode==='pending'||mode==='locked')await expect(result).resolves.toEqual({relocked:mode==='locked',detail:mode==='locked'?'relocked:incoming-a':'lock_pending_announce_time'});
 else await expect(result).rejects.toMatchObject({status:'query_failed',errorCode:mode==='persist-error'?'rotation_emergency_persist_unverified':mode==='persist-malformed'?'rotation_persist_receipt_invalid':mode==='persist-rejected'?'rotation_persist_session_rejected':'rotation_emergency_announce_unverified'});
});
it('isolates a legacy row and still admits the valid table to reconciliation',async()=>{
 const entryStart=source.indexOf('export async function passRRotationPlanner(');
 const entryEnd=source.indexOf('// ─── replanSingleTable',entryStart);
 if(entryStart<0||entryEnd<=entryStart)throw Error('Actual planner entrypoint missing');
 const entry=ts.transpileModule(source.slice(entryStart,entryEnd).replace('export async function','async function'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const invalid={table_id:'physical-b',table_session_id:null};
 const goodSchedule={id:'valid-slot',table_id:'physical-a'};
 const invalidSchedule={id:'invalid-slot',table_id:'physical-b'};
 // Stop at the inspected boundary; this is not a full solver/commit test.
 const reconcile=vi.fn(async()=>{throw Error('test_boundary_after_reconcile');});
 const planner=new Function('fetchActiveAssignments','fetchLiveScheduleRows','fetchTournamentInfo',
  'reconcileAndAdopt','console','crypto',`${entry};return passRRotationPlanner;`)(
  async()=>[assignment,invalid],async()=>[goodSchedule,invalidSchedule],read,reconcile,
  {error:vi.fn()},{randomUUID:()=> 'run-test'},
 );
 const admin=client();const ctx={clubId:'club-a'};
 const result=await planner(admin,ctx);
 expect(reconcile).toHaveBeenCalledWith(admin,ctx,[assignment],[goodSchedule],'run-test');
 expect(result.errors).toContainEqual({scope:'table:physical-b',error:'rotation_assignment_session_missing'});
 expect(result.errors).toContainEqual({scope:'passR',error:'test_boundary_after_reconcile'});
});
it.each(['accepted','rejected','legacy','malformed'] as const)('handles commit receipt=%s',async(mode)=>{
 const rejected=mode==='rejected';
 const entryStart=source.indexOf('export async function passRRotationPlanner(');
 const entryEnd=source.indexOf('// ─── replanSingleTable',entryStart);
 if(entryStart<0||entryEnd<=entryStart)throw Error('Actual planner entrypoint missing');
 const entry=ts.transpileModule(source.slice(entryStart,entryEnd).replace('export async function','async function'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const invalid={table_id:'physical-b',table_session_id:null,attendance_id:'blocked-out',pre_assigned_attendance_id:'blocked-in'};
 const rpc=vi.fn(async()=>({data:{outcome:'ok',...(mode==='legacy'?{}:
  {rejected_table_ids:mode==='malformed'?null:rejected?['physical-a']:[]})},error:null}));
 const supply=vi.fn(async(_admin:unknown,_club:string,_options:{excludeAttendanceIds:Set<string>})=>({status:'ok',supply:[]}));
 const announce=vi.fn(async(_admin:unknown,_ctx:unknown,_assignments:unknown[])=>({locked:0,errors:[]}));
 const names=['fetchActiveAssignments','fetchLiveScheduleRows','fetchTournamentInfo','reconcileAndAdopt',
  'markOvertime','buildRotationSupply','getFeatureTablePoolsByTableWithStatus','getReservedDealerIds',
  'solveRotationPlan','buildSolverTables','announceDueSlots','rowToJson','SWING_POLICY','ANNOUNCE_LEAD_MS',
  'SOLVER_VERSION','console','crypto'];
 const values=[async()=>[assignment,invalid],async()=>[],read,async()=>({adopted:0,cancelled:0}),
  async()=>0,supply,async()=>({status:'ok',pools:new Map()}),async()=>new Set(),
  ()=>({rows:[]}),()=>[],announce,(row:unknown)=>row,{rest:{executeMinRestFloorMinutes:15}},180000,
  'test',{log:vi.fn(),warn:vi.fn(),error:vi.fn()},{randomUUID:()=> 'run-test'}];
 const planner=new Function(...names,`${entry};return passRRotationPlanner;`)(...values);
 const admin={...client(),rpc};
 const result=await planner(admin,{clubId:'club-a',cycleExcludedIds:new Set(['previously-excluded'])});
 expect(result.errors).toEqual([
  {scope:'table:physical-b',error:'rotation_assignment_session_missing'},
  ...(rejected?[{scope:'table:physical-a',error:'rotation_persist_session_rejected'}]:[]),
  ...(mode==='malformed'?[{scope:'upsert_rotation_plan',error:'rotation_persist_receipt_invalid'}]:[]),
 ]);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('upsert_rotation_plan',{
  p_club_id:'club-a',p_plan_run_id:'run-test',p_rows:[],p_table_ids:['physical-a'],
 });
 expect(supply.mock.calls[0][2].excludeAttendanceIds).toEqual(new Set(['previously-excluded','blocked-out','blocked-in']));
 if(mode==='malformed') expect(announce).not.toHaveBeenCalled();
 else expect(announce.mock.calls[0][2]).toEqual(rejected?[]:[assignment]);
});
it('announces a retained unchanged prediction from an earlier plan run',async()=>{
 const first=source.indexOf('async function announceDueSlots(');
 const last=source.indexOf('// ─── Main entry',first);
 if(first<0||last<=first)throw Error('Actual announce seam missing');
 const js=ts.transpileModule(source.slice(first,last),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const announce=new Function('console',`${js};return announceDueSlots;`)({log:vi.fn()});
 const row={id:'retained-slot',club_id:'club-a',table_id:'physical-a',assignment_id:'assignment-a',
  plan_run_id:'previous-run',slot_index:0,status:'predicted',in_attendance_id:'incoming-a',
  announce_at:'2000-01-01T00:00:00Z',planned_relief_at:'2030-01-01T00:00:00Z',version:1};
 let rows=[row,
  {...row,id:'quarantined-table-slot',table_id:'physical-b'},
  {...row,id:'foreign-club-slot',club_id:'club-b'},
  {...row,id:'stale-assignment-slot',assignment_id:'assignment-old'},
  {...row,id:'future-announce-slot',announce_at:'2100-01-01T00:00:00Z'},
  {...row,id:'shortage-slot',in_attendance_id:null},
 ];
 const query={select:vi.fn(),eq:vi.fn(),in:vi.fn(),not:vi.fn(),lte:vi.fn(),
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve)};
 query.select.mockReturnValue(query);
 query.not.mockImplementation((field:string,_operator:string,value:unknown)=>{rows=rows.filter(item=>item[field as keyof typeof row]!==value);return query;});
 query.lte.mockImplementation((field:string,value:unknown)=>{rows=rows.filter(item=>String(item[field as keyof typeof row])<=String(value));return query;});
 query.eq.mockImplementation((field:string,value:unknown)=>{rows=rows.filter(item=>item[field as keyof typeof row]===value);return query;});
 query.in.mockImplementation((field:string,values:unknown[])=>{rows=rows.filter(item=>values.includes(item[field as keyof typeof row]));return query;});
 const rpc=vi.fn(async()=>({data:{outcome:'locked'},error:null}));
 const result=await announce({from:()=>query,rpc},{clubId:'club-a',cycleExcludedIds:new Set()},
  [{...assignment,id:'assignment-a'}],new Map(),new Map());
 expect(result.locked).toBe(1);
 expect(result.errors).toEqual([{scope:'lock:physical-a',error:'rotation_schedule_assignment_changed'}]);
 expect(query.in).toHaveBeenCalledWith('table_id',['physical-a']);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('lock_rotation_slot',{p_schedule_id:'retained-slot',p_schedule_version:1});
 query.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(resolve);
 const unavailable=await announce({from:()=>query,rpc},{clubId:'club-a',cycleExcludedIds:new Set()},
  [{...assignment,id:'assignment-a'}],new Map(),new Map());
 expect(unavailable).toEqual({locked:0,errors:[{scope:'announce_query',error:'rotation_announce_snapshot_unavailable'}]});
 expect(rpc).toHaveBeenCalledTimes(1);
});
