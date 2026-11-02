import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import OpsTrackerWorkspace from './OpsTrackerWorkspace';
const h=vi.hoisted(()=>({club:'club-a',capLoading:false,allowed:true,scopeError:null as string|null,rpc:vi.fn(),rpcSignals:[] as AbortSignal[],reads:[] as {table:string;signal?:AbortSignal;resolve:(value:unknown)=>void}[]}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{
 const client={rpc:(name:string,args:Record<string,unknown>)=>{const q={abortSignal:(signal:AbortSignal)=>{h.rpcSignals.push(signal);return q;},then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>Promise.resolve(h.rpc(name,args)).then(resolve,reject)};return q;},from:(table:string)=>{let signal:AbortSignal|undefined;const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,order:()=>q,limit:()=>q,
 abortSignal:(next:AbortSignal)=>{signal=next;return q;},then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>new Promise(done=>h.reads.push({table,signal,resolve:done})).then(resolve,reject)};return q;}};
 return {useSupabaseClient:()=>client};
});
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:h.capLoading,scopeError:h.scopeError,isSuperAdmin:false,moduleClubIds:()=>h.capLoading||!h.allowed?[]:[h.club],clubs:[{id:h.club,name:h.club}]})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:h.club})}));
const tour=(name='Tour A')=>({id:'tour-a',name,status:'live',start_time:'2026-10-27T12:00:00Z',current_players:2,current_level:1});
const table={id:'table-a',tournament_id:'tour-a',table_number:1,table_name:'Table A',status:'active',max_seats:9};
async function finishTour(index=0,name='Tour A'){
 await act(async()=>h.reads[index].resolve({data:[tour(name)],error:null}));
 await waitFor(()=>expect(h.reads.length).toBeGreaterThanOrEqual(index+3));
}
async function finishChildren(index=1,bad?:string){await act(async()=>{for(const read of h.reads.slice(index,index+2))read.resolve({data:read.table===bad?null:read.table==='tournament_tables'?[table]:[{table_id:'table-a'}],error:null});});}
describe('Ops Tracker actual read adapter/workspace',()=>{
 beforeEach(()=>{h.club='club-a';h.capLoading=false;h.allowed=true;h.scopeError=null;h.reads=[];h.rpcSignals=[];h.rpc.mockReset().mockImplementation((_name,args)=>({data:{tournament_id:args.p_tournament_id,average_stack:30000,counts:{total_entries:3,re_entries:0,remaining:1,seated:1,waiting:0,busted:2,anomaly_entries:0,anomaly_seats:0,live_entry_stack:30000,seated_stack:30000,waiting_stack:0}},error:null}));});afterEach(()=>{cleanup();vi.useRealTimers();});
 it.each(['tournaments','tournament_tables','tournament_seats'])('does not turn null %s into a verified empty or zero snapshot',async(bad)=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));
  if(bad==='tournaments')await act(async()=>h.reads[0].resolve({data:null,error:null}));else{await finishTour();await finishChildren(1,bad);}
  expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(screen.queryByText('Không có giải đang vận hành trong CLB này.')).not.toBeInTheDocument();expect(screen.queryByText('Tour A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Thời điểm đọc snapshot')).not.toBeInTheDocument();
 });
 it('settles a hung read after10s, aborts transport and ignores late completion',async()=>{
  vi.useFakeTimers();render(<OpsTrackerWorkspace/>);await act(async()=>{await Promise.resolve();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(h.reads[0].signal?.aborted).toBe(true);
  await act(async()=>h.reads[0].resolve({data:[tour()],error:null}));expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(h.reads).toHaveLength(1);
 });
 it('aborts all owned reads when a child table or seat read hangs',async()=>{
  vi.useFakeTimers();render(<OpsTrackerWorkspace/>);await act(async()=>{await Promise.resolve();});
  await act(async()=>h.reads[0].resolve({data:[tour()],error:null}));expect(h.reads).toHaveLength(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(h.reads.every(r=>r.signal?.aborted)).toBe(true);
 });
 it('retries explicitly and restores the verified positive snapshot',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await act(async()=>h.reads[0].resolve({data:null,error:null}));
  expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Làm mới Tracker'}));await waitFor(()=>expect(h.reads).toHaveLength(2));await finishTour(1);await finishChildren(2);expect(screen.getByText('Tour A')).toBeInTheDocument();
  expect(Number.isFinite(Date.parse(screen.getByLabelText('Thời điểm đọc snapshot').getAttribute('datetime')!))).toBe(true);
 });
 it('accepts a verified empty list',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await act(async()=>h.reads[0].resolve({data:[],error:null}));expect(screen.getByText('Không có giải đang vận hành trong CLB này.')).toBeInTheDocument();
 });
 it('accepts verified empty table and seat arrays without a read error',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();
  await act(async()=>{for(const read of h.reads.slice(1))read.resolve({data:[],error:null});});expect(screen.getByText('Tour A')).toBeInTheDocument();expect(screen.queryByText('Không tải được Tracker')).not.toBeInTheDocument();
 });
 it('hides the prior club snapshot while another club read is pending',async()=>{
  const view=render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();await finishChildren();expect(screen.getByText('Tour A')).toBeInTheDocument();
  h.club='club-b';view.rerender(<OpsTrackerWorkspace/>);expect(screen.queryByText('Tour A')).not.toBeInTheDocument();
 });
 it('does not render or count closed historical tables beside the current table',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();
  await act(async()=>{for(const read of h.reads.slice(1))read.resolve({data:read.table==='tournament_tables'?[{...table,id:'closed-one',table_name:'Closed prior table',status:'closed'},{...table,id:'closed-two',table_number:1,table_name:'Closed prior session',status:'closed'},table]:[{table_id:'table-a'},{table_id:'table-a'},{table_id:'closed-one'}],error:null});});
  expect(screen.queryByText('Closed prior table')).not.toBeInTheDocument();expect(screen.queryByText('Closed prior session')).not.toBeInTheDocument();expect(screen.getByText('Table A')).toBeInTheDocument();expect(screen.getByText('2/9')).toBeInTheDocument();expect(screen.getByText('Bàn',{exact:true}).parentElement).toHaveTextContent('Bàn1');
 });
 it('renders no current table when all returned table rows are explicitly closed',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();
  await act(async()=>{for(const read of h.reads.slice(1))read.resolve({data:read.table==='tournament_tables'?[{...table,status:'closed'}]:[],error:null});});
  expect(screen.getByText('Chưa có bàn.')).toBeInTheDocument();expect(screen.getByText('Bàn',{exact:true}).parentElement).toHaveTextContent('Bàn0');expect(screen.queryByText('Table A')).not.toBeInTheDocument();
 });

 it('shows pending presentation while club scope is loading, then loads the verified model',async()=>{
  h.capLoading=true;const view=render(<OpsTrackerWorkspace/>);expect(screen.getByText('Đang tải snapshot Tracker…')).toBeInTheDocument();expect(screen.queryByText('TRACKER_CLUB_SCOPE_REQUIRED')).not.toBeInTheDocument();expect(h.reads).toHaveLength(0);h.capLoading=false;view.rerender(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();await finishChildren();expect(screen.getByText('Tour A')).toBeInTheDocument();
 });
 it('keeps the existing missing-scope error after loading completes and does not issue reads',()=>{
  h.capLoading=true;h.allowed=false;const view=render(<OpsTrackerWorkspace/>);expect(screen.queryByText('TRACKER_CLUB_SCOPE_REQUIRED')).not.toBeInTheDocument();h.capLoading=false;view.rerender(<OpsTrackerWorkspace/>);expect(screen.getByText('TRACKER_CLUB_SCOPE_REQUIRED')).toBeInTheDocument();expect(h.reads).toHaveLength(0);
 });
 it('shows a completed scope read error after the pending state instead of hiding it',()=>{
  h.capLoading=true;h.scopeError='SCOPE_READ_FAILED';const view=render(<OpsTrackerWorkspace/>);expect(screen.queryByText('SCOPE_READ_FAILED')).not.toBeInTheDocument();h.capLoading=false;view.rerender(<OpsTrackerWorkspace/>);expect(screen.getByText('SCOPE_READ_FAILED')).toBeInTheDocument();expect(h.reads).toHaveLength(0);
 });

 it('uses canonical remaining players instead of the stored tournament counter',async()=>{
  render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();await finishChildren();
  expect(screen.getByText('Người chơi',{exact:true}).parentElement).toHaveTextContent('Người chơi1');
  expect(h.rpc).toHaveBeenCalledWith('get_tournament_participation_counts_v1',{p_tournament_id:'tour-a'});
 });
 it.each([null,{tournament_id:'other',average_stack:0,counts:{}}])('refuses unavailable or foreign canonical participation %j instead of stored counters',async(data)=>{
  h.rpc.mockReturnValue({data,error:null});render(<OpsTrackerWorkspace/>);await waitFor(()=>expect(h.reads).toHaveLength(1));await finishTour();await finishChildren();
  expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(screen.queryByText('Tour A')).not.toBeInTheDocument();
 });

 it('bounds and aborts a hung canonical participation read and ignores its late result',async()=>{
  vi.useFakeTimers();let release!:(value:unknown)=>void;const ready=h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  render(<OpsTrackerWorkspace/>);await act(async()=>{await Promise.resolve();});
  await act(async()=>h.reads[0].resolve({data:[tour()],error:null}));await finishChildren();
  expect(h.rpcSignals).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();expect(h.rpcSignals[0].aborted).toBe(true);
  await act(async()=>release(ready('get_tournament_participation_counts_v1',{p_tournament_id:'tour-a'})));
  expect(screen.queryByText('Tour A')).not.toBeInTheDocument();expect(screen.getByText('Không tải được Tracker')).toBeInTheDocument();
 });

});


describe.skipIf(process.env.VINPOKER_TRACKER1213_LOCAL!=='1'&&process.env.VINPOKER_TRACKER1214_LOCAL!=='1')('Tracker SDK native latency diagnostics',()=>{
 it('measures the actual read adapter with four native canonical summaries without browser automation',async()=>{
  const {createClient}=await import('@supabase/supabase-js');
  const {loadTrackerReadModel}=await import('./trackerReadAdapter');
  const {writeFileSync,existsSync}=await import('node:fs');
  const run=process.env.VINPOKER_TRACKER1214_LOCAL==='1'?'1214':'1213';
  const output='D:/Quy trình/output/reports/tracker'+run+'-sdk-model-observations-local-20261028.json';
  expect(existsSync(output)).toBe(false);
  const manifest=await fetch('http://127.0.0.1:54329/__local/manifest').then(r=>r.json());
  expect(manifest.runId).toBe(run);expect(manifest.actor).toBe('675fe35e-60a8-4452-bb90-e79486d54da6');
  const client=createClient<import('@/integrations/supabase/types').Database>('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await client.auth.signInWithPassword({email:manifest.email,password:'LOCAL_TEST_ONLY'});expect(login.error).toBeNull();
  const observations=[];let baseline:unknown;
  for(let i=0;i<21;i++){
   const started=performance.now(),model=await loadTrackerReadModel(client,manifest.club),elapsedMs=performance.now()-started;
   const rows=model.tournaments.map(t=>({id:t.id,name:t.name,players:t.currentPlayers,tables:t.tables}));
   expect(rows).toHaveLength(4);expect(rows.map(x=>x.players)).toEqual([2,1,0,0]);
   if(i===0)baseline=rows;else expect(rows).toEqual(baseline);
   observations.push({sample:i,warm:i>0,elapsedMs,loadedAt:model.loadedAt,rows});
   writeFileSync(output,JSON.stringify({kind:'ACTUAL_SDK_LOAD_TRACKER_MODEL_NATIVE_READONLY_NOT_BROWSER',observations,wholeJourneyAccepted:false},null,2));
  }
 },90000);
});
