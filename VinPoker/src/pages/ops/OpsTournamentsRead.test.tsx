import {render,screen,fireEvent} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const read=vi.hoisted(()=>({data:[] as unknown[],isLoading:false,isError:false,error:null as unknown,refetch:vi.fn()}));
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
 beforeEach(()=>{read.data=[];read.isLoading=false;read.isError=false;read.error=null;read.refetch.mockReset();});
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
});
