import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({loading:false,error:true,fetching:false,retry:vi.fn(),checkIn:vi.fn()}));
vi.mock('@/hooks/staff/useStaffLink',()=>({useStaffLink:()=>({staff:{staffId:'staff',fullName:'TEST staff',department:'service',status:'active',clubName:'TEST'},isStaff:true,loading:false})}));
vi.mock('@/hooks/staff/useStaffAttendance',()=>({useStaffAttendance:()=>({rows:[],openAttendance:null,isLoading:f.loading,isError:f.error,scopeError:null,isFetching:f.fetching,refetch:f.retry})}));
vi.mock('@/hooks/staff/useStaffAttendanceActions',()=>({useStaffAttendanceActions:()=>({checkIn:{mutate:f.checkIn},checkOut:{mutate:vi.fn()},isPending:false})}));
vi.mock('@/components/staff-app/StaffNotLinkedScreen',()=>({StaffNotLinkedScreen:()=> <p>TEST not linked</p>}));
import {StaffAttendanceScreen} from './StaffAttendanceScreen';
import {StaffHomeScreen} from '../home/StaffHomeScreen';
beforeEach(()=>{vi.clearAllMocks();f.loading=false;f.error=true;f.fetching=false;f.retry.mockResolvedValue(undefined);});
describe('staff attendance availability',()=>{
 it('does not show failed attendance as an empty history',()=>{
  render(<StaffAttendanceScreen/>);expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  expect(screen.queryByText('Chưa có dòng chấm công nào.')).not.toBeInTheDocument();
 });
 it('does not offer check-in after an attendance read error',()=>{
  render(<StaffHomeScreen/>);expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  expect(screen.queryByRole('button',{name:'Check-in'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(f.retry).toHaveBeenCalledTimes(1);expect(f.checkIn).not.toHaveBeenCalled();
 });
 it('does not offer check-in before the initial attendance read finishes',()=>{
  f.error=false;f.loading=true;render(<StaffHomeScreen/>);
  expect(screen.queryByRole('button',{name:'Check-in'})).not.toBeInTheDocument();
 });
 it('keeps check-in available after an explicit empty successful read',()=>{
  f.error=false;render(<StaffHomeScreen/>);expect(screen.getByRole('button',{name:'Check-in'})).toBeEnabled();
 });
 it('holds operational controls while refreshing last-good attendance',()=>{
  f.error=false;f.fetching=true;render(<StaffHomeScreen/>);
  const button=screen.getByRole('button',{name:'Đang xác minh ca…'});expect(button).toBeDisabled();
  fireEvent.click(button);expect(f.checkIn).not.toHaveBeenCalled();
 });
});
