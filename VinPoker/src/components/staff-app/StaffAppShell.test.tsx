import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({error:'Không xác minh được hồ sơ TEST.' as string|null,loading:false,refetch:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'},isAdmin:false,isClubOwner:false,loading:false})}));
vi.mock('@/hooks/staff/useStaffLink',()=>({useStaffLink:()=>({loading:f.loading,source:'live',error:f.error,refetch:f.refetch,isFetching:false})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{staffApp:true}}));
vi.mock('@/components/LanguageSwitcher',()=>({LanguageSwitcher:()=>null}));
vi.mock('@/components/BackButton',()=>({BackButton:()=>null}));
vi.mock('@/components/RouteLoader',()=>({RouteLoader:()=> <p>TEST_LOADING</p>}));
vi.mock('./StaffClubSwitcher',()=>({StaffClubSwitcher:()=>null}));
vi.mock('./StaffBottomNav',()=>({StaffBottomNav:()=>null}));
vi.mock('./StaffComingSoon',()=>({StaffComingSoon:()=>null}));
import StaffAppShell from './StaffAppShell';
function show(){return render(<MemoryRouter initialEntries={['/staff']}><Routes><Route element={<StaffAppShell/>}>
 <Route path="/staff" element={<p>TEST_STAFF_OPERATIONS</p>}/></Route></Routes></MemoryRouter>);}
beforeEach(()=>{f.error='Không xác minh được hồ sơ TEST.';f.loading=false;f.refetch.mockReset();f.refetch.mockResolvedValue(undefined);});
describe('staff portal membership gate',()=>{
 it('does not render operational children or an unlink flow when membership read fails',()=>{
  show();expect(screen.getByRole('alert')).toHaveTextContent('Không tải được hồ sơ nhân viên');
  expect(screen.queryByText('TEST_STAFF_OPERATIONS')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Tải lại hồ sơ'}));expect(f.refetch).toHaveBeenCalledTimes(1);
 });
 it('waits for membership verification before rendering children',()=>{
  f.loading=true;show();expect(screen.getByText('TEST_LOADING')).toBeInTheDocument();
  expect(screen.queryByText('TEST_STAFF_OPERATIONS')).not.toBeInTheDocument();
 });
 it('renders operational children after a successful membership read',()=>{
  f.error=null;show();expect(screen.getByText('TEST_STAFF_OPERATIONS')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
});
