import {render,screen,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const read=vi.hoisted(()=>({data:[] as unknown[],isLoading:false,isFetching:false,dataUpdatedAt:0,isError:false,error:null as unknown,refetch:vi.fn()}));
vi.mock('@/hooks/useTournaments',()=>({useTournaments:()=>read}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({})}));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:'floor-test'}})}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,clubs:[{id:'club-test',name:'Quads TEST'}],floorClubIds:['club-test'],scope:[{club_id:'club-test',can_owner:false}],isSuperAdmin:false,scopeError:null,metadataError:null})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:'club-test'})}));
vi.mock('@/components/floor/FloorVoiceAlertInbox',()=>({FloorVoiceAlertInbox:()=>null}));
vi.mock('@/ops/opsMutations',()=>({createTournament:vi.fn(),updateTournament:vi.fn(),updateTournamentLive:vi.fn(),mutationError:()=> 'TEST failure'}));
import OpsTournaments from './OpsTournaments';
describe('Floor tournament read states',()=>{
 it('offers a read-only explicit refresh and disables it while fetching',()=>{
  const view=render(<OpsTournaments/>);fireEvent.click(screen.getByRole('button',{name:'Làm mới danh sách giải'}));expect(read.refetch).toHaveBeenCalledOnce();
  read.isFetching=true;view.rerender(<OpsTournaments/>);expect(screen.getByRole('button',{name:'Làm mới danh sách giải'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Làm mới danh sách giải'}));expect(read.refetch).toHaveBeenCalledOnce();
 });
 it('shows only a completed query read timestamp and hides it while fetching or failed',()=>{
  read.dataUpdatedAt=Date.parse('2026-10-27T00:00:00Z');const view=render(<OpsTournaments/>);
  expect(view.container.querySelector('time')).toHaveAttribute('datetime','2026-10-27T00:00:00.000Z');
  read.isFetching=true;view.rerender(<OpsTournaments/>);expect(view.container.querySelector('time')).toBeNull();
  read.isFetching=false;read.isError=true;view.rerender(<OpsTournaments/>);expect(view.container.querySelector('time')).toBeNull();
 });
 afterEach(()=>vi.useRealTimers());
 beforeEach(()=>{read.data=[];read.isLoading=false;read.isFetching=false;read.dataUpdatedAt=0;read.isError=false;read.error=null;read.refetch.mockReset();});
 it('shows a query failure instead of claiming zero tournaments and offers retry',()=>{
  read.isError=true;read.error={code:'PGRST201',message:'ambiguous relationship'};
  render(<OpsTournaments/>);
  expect(screen.getByText('Không tải được danh sách giải')).toBeInTheDocument();
  expect(screen.queryByText('Không có giải nào đang chơi.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(read.refetch).toHaveBeenCalledOnce();
 });
 it('does not hide a canonical active tournament as completed',()=>{
  read.data=[{id:'tour-test',name:'TEST active tournament',status:'active',start_time:'2026-10-14T10:00:00Z',buy_in:0,players_remaining:8,current_level:1,current_blinds:null}];
  render(<OpsTournaments/>);
  expect(screen.getByText('TEST active tournament')).toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
 });
 it('labels registration-open tournaments without presenting them as completed',()=>{
  read.data=[{id:'tour-test',name:'TEST registration open',status:'registration_open',start_time:'2026-10-14T10:00:00Z',buy_in:0,players_remaining:8,current_level:1,current_blinds:null}];
  render(<OpsTournaments/>);
  fireEvent.click(screen.getByRole('button',{name:'Tất cả (1)'}));
  expect(screen.getByText('Đang đăng ký')).toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
 });
 it('shows paused tournaments in the operational list rather than hiding them as completed',()=>{
  read.data=[{id:'tour-test',name:'TEST paused',status:'paused',start_time:'2026-10-14T10:00:00Z',buy_in:0,players_remaining:8,current_level:1,current_blinds:null}];
  render(<OpsTournaments/>);
  expect(screen.getByText('TEST paused')).toBeInTheDocument();
  expect(screen.getByText('Tạm dừng')).toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
 });
 it('retains unknown status as text in the all list instead of claiming completion',()=>{
  read.data=[{id:'tour-test',name:'TEST unknown',status:'future_status',start_time:'2026-10-14T10:00:00Z',buy_in:0,players_remaining:8,current_level:1,current_blinds:null}];
  render(<OpsTournaments/>);
  fireEvent.click(screen.getByRole('button',{name:'Tất cả (1)'}));
  expect(screen.getByText('future status')).toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
 });
 it.each([
  ['2026-12-31T17:00:00.000Z','2026-12-31T16:59:59.999Z','2026-12-31T17:00:00.000Z','2027-01-01T16:59:59.999Z','2027-01-01T17:00:00.000Z'],
  ['2026-10-26T16:59:59.999Z','2026-10-25T16:59:59.999Z','2026-10-25T17:00:00.000Z','2026-10-26T16:59:59.999Z','2026-10-26T17:00:00.000Z'],
 ])('filters Today by the Vietnam calendar at %s and preserves All', (now,previous,start,end,next)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(now));
  read.data=[previous,start,end,next,'not-a-date'].map((start_time,index)=>({id:`date-${index}`,name:`Calendar TEST ${index}`,status:'upcoming',start_time,buy_in:0,players_remaining:0,current_level:1,current_blinds:null}));
  render(<OpsTournaments/>);
  fireEvent.click(screen.getByRole('button',{name:'Hôm nay'}));
  expect(screen.getByRole('button',{name:'Hôm nay'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'Đang chơi'})).toHaveAttribute('aria-pressed','false');
  expect(screen.getByText('Calendar TEST 1')).toBeInTheDocument();
  expect(screen.getByText('Calendar TEST 2')).toBeInTheDocument();
  for(const index of [0,3,4])expect(screen.queryByText(`Calendar TEST ${index}`)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Tất cả (5)'}));
  expect(screen.getByRole('button',{name:'Tất cả (5)'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'Hôm nay'})).toHaveAttribute('aria-pressed','false');
  for(let index=0;index<5;index++)expect(screen.getByText(`Calendar TEST ${index}`)).toBeInTheDocument();
 });
});
