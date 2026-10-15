import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc}}));
import PublicTournamentClock from './PublicTournamentClock';
function show(){return render(<MemoryRouter initialEntries={['/clock/tour-a']}><Link to='/clock/tour-b'>Change tournament</Link><Routes>
 <Route path='/clock/:tournamentId' element={<PublicTournamentClock/>}/></Routes></MemoryRouter>);}
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
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
