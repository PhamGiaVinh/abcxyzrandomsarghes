import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc}}));
import PublicTournamentClock from './PublicTournamentClock';
function show(){return render(<MemoryRouter initialEntries={['/clock/tour-a']}><Link to='/clock/tour-b'>Change tournament</Link><Routes>
 <Route path='/clock/:tournamentId' element={<PublicTournamentClock/>}/></Routes></MemoryRouter>);}
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
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
