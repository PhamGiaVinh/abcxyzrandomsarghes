import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn(),format:vi.fn(),channel:vi.fn(),removeChannel:vi.fn()}));
const flags=vi.hoisted(()=>({publicSpectatorRealtimeV2:false}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:flags}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc,channel:api.channel,removeChannel:api.removeChannel}}));
vi.mock('@/components/cashier/tournament-live/viewer-hub/hubDerive',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/components/cashier/tournament-live/viewer-hub/hubDerive')>();
 return {...actual,fmtCompact:(value:number)=>{api.format();return actual.fmtCompact(value);}};
});
import PublicTournamentClock from './PublicTournamentClock';
function show(){return render(<MemoryRouter initialEntries={['/clock/tour-a']}><Link to='/clock/tour-b'>Change tournament</Link><Routes>
 <Route path='/clock/:tournamentId' element={<PublicTournamentClock/>}/></Routes></MemoryRouter>);}
afterEach(async()=>{cleanup();await Promise.resolve();flags.publicSpectatorRealtimeV2=false;vi.useRealTimers();vi.resetAllMocks();vi.restoreAllMocks();});
function realtimeFixture(){
 flags.publicSpectatorRealtimeV2=true;vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(.5);
 let changed!:(value:unknown)=>void,status!:(value:string)=>void;
 const channel={on:vi.fn((_type,_event,callback)=>{changed=callback;return channel;}),subscribe:vi.fn(callback=>{status=callback;return channel;})};
 api.channel.mockReturnValue(channel);
 return {changed:(components:string[])=>changed({payload:{tournamentId:'tour-a',components}}),status:(value:string)=>status(value)};
}
function abortable(data:unknown){return Object.assign(Promise.resolve({data,error:null}),{abortSignal:vi.fn(function(){return this;})});}
it('refreshes only clock for a clock signal, ignores table traffic and uses the shared healthy timer',async()=>{
 const rt=realtimeFixture();let level=1;
 api.rpc.mockImplementation((name:string)=>abortable(name==='get_public_tournament_results'?[]:
  {id:'tour-a',name:'Realtime TEST',current_level:level,status:'live',is_running:false,remaining_seconds:120}));
 show();rt.status('SUBSCRIBED');await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Level 1')).toBeInTheDocument();expect(api.channel).toHaveBeenCalledTimes(1);
 api.rpc.mockClear();level=2;
 await act(async()=>{rt.changed(['tables']);await vi.advanceTimersByTimeAsync(2000);});
 expect(api.rpc).not.toHaveBeenCalled();
 await act(async()=>{rt.changed(['clock']);await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Level 2')).toBeInTheDocument();
 expect(api.rpc.mock.calls.map(([name])=>name)).toEqual(['get_public_tournament_clock_summary']);
 api.rpc.mockClear();await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(api.rpc).not.toHaveBeenCalled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(12000);});
 expect(api.rpc.mock.calls.map(([name])=>name).sort()).toEqual(['get_public_tournament_clock_summary','get_public_tournament_results'].sort());
});
it('clears a withdrawn clock immediately and rejects its delayed in-flight public response',async()=>{
 const rt=realtimeFixture();let delayed=false,revoked=false,resolveOld!:(value:unknown)=>void;
 api.rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_results')return abortable([]);
  if(delayed&&!revoked)return Object.assign(new Promise(resolve=>{resolveOld=resolve;}),{abortSignal(){return this;}});
  return abortable(revoked?[]:{id:'tour-a',name:'Withdraw TEST',current_level:1});
 });
 show();rt.status('SUBSCRIBED');await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Withdraw TEST')).toBeInTheDocument();delayed=true;
 await act(async()=>{rt.changed(['clock']);await vi.advanceTimersByTimeAsync(2000);});
 await act(async()=>{revoked=true;rt.changed(['visibility']);});
 expect(screen.queryByText('Withdraw TEST')).toBeNull();
 await act(async()=>{resolveOld({data:{id:'tour-a',name:'Late withdrawn TEST'},error:null});await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.queryByText('Late withdrawn TEST')).toBeNull();expect(screen.getByText('Đồng hồ công khai chưa sẵn sàng')).toBeInTheDocument();
});
it('keeps clock reads independent from a hung payout and cancels the timed-out payout request',async()=>{
 const rt=realtimeFixture();let level=1;const payoutSignals:AbortSignal[]=[];
 api.rpc.mockImplementation((name:string)=>name==='get_public_tournament_results'
  ?Object.assign(new Promise(()=>{}),{abortSignal(signal:AbortSignal){payoutSignals.push(signal);return this;}})
  :abortable({id:'tour-a',name:'Independent clock TEST',current_level:level}));
 show();rt.status('SUBSCRIBED');await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Independent clock TEST')).toBeInTheDocument();expect(screen.getByText('Level 1')).toBeInTheDocument();
 level=2;await act(async()=>{rt.changed(['clock']);await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('Level 2')).toBeInTheDocument();expect(payoutSignals[0].aborted).toBe(false);
 await act(async()=>{await vi.advanceTimersByTimeAsync(6001);});
 expect(payoutSignals[0].aborted).toBe(true);expect(screen.getByText('Independent clock TEST')).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('Không tải được dữ liệu payout');
});
it('ticks the countdown without rerendering payout, stack or blind values or rereading the server',async()=>{
 vi.useFakeTimers();
 api.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_public_tournament_results'
  ?[{place:1,prize:200000,player_name:'Tick TEST',result_status:'official'}]
  :{id:'tour-a',name:'Isolated tick TEST',status:'live',is_running:true,average_stack:40000,
   small_blind:100,big_blind:200,level_ends_at:new Date(Date.now()+120000).toISOString()},error:null}));
 show();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('02:00')).toBeInTheDocument();
 const formatCalls=api.format.mock.calls.length;expect(formatCalls).toBeGreaterThan(0);
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.getByText('01:55')).toBeInTheDocument();
 expect(screen.getByText('Tick TEST')).toBeInTheDocument();
 expect(api.format).toHaveBeenCalledTimes(formatCalls);expect(api.rpc).toHaveBeenCalledTimes(2);
});
it('keeps explicit public payout pending distinct from a failure and polls for publication',async()=>{
 vi.useFakeTimers();let published=false;
 api.rpc.mockImplementation((name:string)=>Promise.resolve(name==='get_public_tournament_results'
  ?published?{data:[{place:1,prize:100,player_name:'Published TEST',result_status:'official'}],error:null}
   :{data:null,error:{message:'public_payout_pending'}}
  :{data:{id:'tour-a',name:'Pending TEST',status:'running'},error:null}));
 show();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByRole('status')).toHaveTextContent('Payout đang chờ xác minh');
 expect(screen.queryByRole('button',{name:'Thử tải lại payout'})).toBeNull();
 published=true;await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(screen.getByText('Published TEST')).toBeInTheDocument();
 expect(screen.queryByText(/Payout đang chờ xác minh/)).toBeNull();
});
it('does not label a completed tournament live or count down a finished level',async()=>{
 api.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_public_tournament_results'
  ?[{place:1,prize:200000,player_name:'Winner TEST',result_status:'official'}]
  :{id:'tour-a',name:'Completed TEST',status:'completed',is_running:false,remaining_seconds:125},error:null}));
 show();await screen.findByText('Completed TEST');
 expect(screen.getByText('Đã kết thúc')).toBeInTheDocument();
 expect(screen.queryByText('Live',{exact:true})).toBeNull();
 expect(screen.queryByText('Level kết thúc trong')).toBeNull();
 expect(screen.queryByText('02:05')).toBeNull();
 expect(screen.getByText('Winner TEST')).toBeInTheDocument();
});
it.each([['live','Live'],['finished','Đã kết thúc'],['cancelled','Đã hủy'],['scheduled','Chưa bắt đầu'],['unknown','Chưa xác minh trạng thái']])('renders server status %s as %s',async(status,label)=>{
 api.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_public_tournament_results'?[]
  :{id:'tour-a',name:'Status TEST',status},error:null}));
 show();await screen.findByText('Status TEST');expect(screen.getByText(label,{exact:true})).toBeInTheDocument();
});
it('calls the public RPC with its Supabase client receiver intact',async()=>{
 api.rpc.mockImplementation(function(this:{rpc:unknown}|undefined,name:string){
  if(this?.rpc!==api.rpc) throw new Error('Supabase RPC receiver lost');
  return Promise.resolve({data:name==='get_public_tournament_results'?[]:{id:'tour-a',name:'Receiver TEST'},error:null});
 });
 show();expect(await screen.findByText('Receiver TEST')).toBeInTheDocument();
});
it('freezes server remaining time while stopped and resumes from the next server deadline',async()=>{
 vi.useFakeTimers();
 let running=false;
 api.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_public_tournament_results'?[]:{
  tournament_id:'tour-a',name:'Pause TEST',remaining_seconds:125,is_running:running,
  level_ends_at:running?new Date(Date.now()+120000).toISOString():null,
 },error:null}));
 show();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('02:05')).toBeInTheDocument();
 expect(screen.getByText('Đồng hồ đang dừng')).toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.getByText('02:05')).toBeInTheDocument();
 running=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 expect(screen.getByText('02:00')).toBeInTheDocument();
 expect(screen.queryByText('Đồng hồ đang dừng')).toBeNull();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(screen.getByText('01:58')).toBeInTheDocument();
});
it('does not format invalid or missing server time as zero or NaN',async()=>{
 api.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_public_tournament_results'?[]:{
  tournament_id:'tour-a',name:'Invalid time TEST',remaining_seconds:null,is_running:false,level_ends_at:'invalid',
 },error:null}));
 show();expect(await screen.findByText('--:--')).toBeInTheDocument();
 expect(screen.queryByText('00:00')).toBeNull();
 expect(screen.queryByText('NaN:NaN')).toBeNull();
});
it('shows a retryable unavailable state when a public read rejects',async()=>{
 api.rpc.mockRejectedValue(new TypeError('network'));
 show();
 expect(await screen.findByText('Đồng hồ công khai chưa sẵn sàng')).toBeInTheDocument();
 expect(screen.queryByText('Đang đồng bộ đồng hồ...')).toBeNull();
 const previous=api.rpc.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));
 await waitFor(()=>expect(api.rpc.mock.calls.length).toBe(previous+2));
});
it('does not leave a hung read in infinite loading',async()=>{
 vi.useFakeTimers();api.rpc.mockImplementation(()=>new Promise(()=>{}));
 show();
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByText('Đồng hồ công khai chưa sẵn sàng')).toBeInTheDocument();
 expect(api.rpc).toHaveBeenCalledTimes(2);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 expect(api.rpc).toHaveBeenCalledTimes(2);
});
it('does not show an old tournament response after navigation',async()=>{
 let oldResolve!:(value:unknown)=>void;
 api.rpc.mockImplementation((name:string,args:{p_tournament_id:string})=>{
  if(name==='get_public_tournament_results') return Promise.resolve({data:[],error:null});
  if(args.p_tournament_id==='tour-a') return new Promise(resolve=>{oldResolve=resolve;});
  return Promise.resolve({data:{id:'tour-b',name:'Tournament B'},error:null});
 });
 show();fireEvent.click(screen.getByRole('link',{name:'Change tournament'}));
 expect(await screen.findByText('Tournament B')).toBeInTheDocument();
 await act(async()=>{oldResolve({data:{id:'tour-a',name:'Late tournament A'},error:null});});
 expect(screen.queryByText('Late tournament A')).toBeNull();
 expect(screen.getByText('Tournament B')).toBeInTheDocument();
});
it('rejects a successful clock response belonging to a different tournament',async()=>{
 api.rpc.mockResolvedValue({data:{id:'other-tour',name:'Wrong tournament'},error:null});
 show();await screen.findByText('Đồng hồ công khai chưa sẵn sàng');
 expect(screen.queryByText('Wrong tournament')).toBeNull();
});
it('distinguishes payout read failure from a confirmed empty result',async()=>{
 api.rpc.mockImplementation((name:string)=>Promise.resolve(name==='get_public_tournament_clock_summary'
  ?{data:{id:'tour-a',name:'Clock TEST',current_level:1},error:null}
  :{data:null,error:{message:'denied'}}));
 show();
 expect(await screen.findByText('Clock TEST')).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('Không tải được dữ liệu payout');
});
