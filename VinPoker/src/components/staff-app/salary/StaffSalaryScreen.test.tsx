import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({refetch:vi.fn(),error:true,scopeError:null as string|null,monthly:null as number|null,employment:'part_time'}));
vi.mock('@/hooks/staff/useStaffLink',()=>({useStaffLink:()=>({staff:{staffId:'staff',employmentType:f.employment},isStaff:true,loading:false})}));
vi.mock('@/hooks/staff/useStaffSalary',()=>({useStaffSalary:()=>({salary:f.error?null:{balanceVnd:0,hourlyRateVnd:0,accruedMinutes:0,
  monthlySalaryVnd:f.monthly,recentPayments:[]},isLoading:false,isError:f.error,scopeError:f.scopeError,refetch:f.refetch})}));
vi.mock('../StaffNotLinkedScreen',()=>({StaffNotLinkedScreen:()=> <p>TEST not linked</p>}));
import {StaffSalaryScreen} from './StaffSalaryScreen';
beforeEach(()=>{vi.clearAllMocks();f.error=true;f.scopeError=null;f.monthly=null;f.employment='part_time';f.refetch.mockResolvedValue(undefined);});
describe('staff salary availability',()=>{
 it('does not show empty paid history as a successful read when salary failed',()=>{
  render(<StaffSalaryScreen/>);expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh');
  expect(screen.queryByText('Chưa có lần chi trả nào.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(f.refetch).toHaveBeenCalledTimes(1);
 });
 it('does not display missing FT salary as zero',()=>{
  f.error=false;f.employment='full_time';render(<StaffSalaryScreen/>);
  expect(screen.getByText('Chưa cấu hình mức lương tháng.')).toBeInTheDocument();
 });
});
