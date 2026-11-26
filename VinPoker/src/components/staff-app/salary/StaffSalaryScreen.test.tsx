import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({refetch:vi.fn(),error:true,scopeError:null as string|null,monthly:null as number|null,employment:'part_time'}));
const ft = vi.hoisted(() => ({ query: null as null | { isError: boolean; data?: unknown[]; pendingAdjustments?:unknown[];refetch: () => void } }));
vi.mock('@/hooks/staff/useStaffLink',()=>({useStaffLink:()=>({staff:{staffId:'staff',employmentType:f.employment},isStaff:true,loading:false})}));
vi.mock('@/hooks/staff/useStaffSalary',()=>({useStaffSalary:()=>({salary:f.error?null:{balanceVnd:0,hourlyRateVnd:0,accruedMinutes:0,
  monthlySalaryVnd:f.monthly,recentPayments:[]},isLoading:false,isError:f.error,scopeError:f.scopeError,refetch:f.refetch,ftPayslips:ft.query})}));
vi.mock('../StaffNotLinkedScreen',()=>({StaffNotLinkedScreen:()=> <p>TEST not linked</p>}));
vi.mock('@/components/staffSalary/SalaryRunSource',()=>({SalaryRunSource:()=>null}));
import {StaffSalaryScreen} from './StaffSalaryScreen';
beforeEach(()=>{vi.clearAllMocks();f.error=true;f.scopeError=null;f.monthly=null;f.employment='part_time';ft.query=null;f.refetch.mockResolvedValue(undefined);});
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
 it('distinguishes saved amounts, approval, and the club recording payment', () => {
  f.error = false;
  f.employment = 'full_time';
  f.monthly = 5200000;
  ft.query = { isError:false, refetch:f.refetch, data:[
    { id:'approved', period_year:2026, period_month:11, net_vnd:4900000, status:'approved', paid_at:null, payment_method:null },
    { id:'paid', period_year:2026, period_month:10, net_vnd:4800000, status:'recorded_paid', paid_at:'2026-11-01T01:00Z', payment_method:'bank_transfer' },
  ] };
  render(<StaffSalaryScreen />);
  expect(screen.getByText('Mức lương tháng theo cấu hình')).toBeVisible();
  expect(screen.getByRole('heading', { name:'11/2026 · 4.900.000đ' })).toBeVisible();
  expect(screen.getByText('Đã duyệt')).toBeVisible();
  expect(screen.getByText(/CLB đã ghi chi.*chuyển khoản/)).toBeVisible();
  expect(screen.queryByText('Chưa có lần chi trả nào.')).not.toBeInTheDocument();
 });
 it('offers a read retry when the monthly payslip lookup fails', () => {
  f.error = false;
  f.employment = 'full_time';
  ft.query = { isError:true, refetch:f.refetch };
  render(<StaffSalaryScreen />);
  expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được phiếu lương tháng.');
  fireEvent.click(screen.getByRole('button', { name:'Tải lại phiếu lương' }));
  expect(f.refetch).toHaveBeenCalledTimes(1);
 });
 it('labels the separate supplement and keeps the original receipt visible',()=>{
  f.error=false;f.employment='full_time';
  ft.query={isError:false,refetch:f.refetch,data:[
   {id:'base',period_year:2026,period_month:11,net_vnd:5000000,status:'recorded_paid',paid_at:'2026-11-26T12:00Z',payment_method:'cash',adjusts_id:null,source_status:'verified'},
   {id:'child',period_year:2026,period_month:11,net_vnd:200000,status:'approved',paid_at:null,payment_method:null,adjusts_id:'base',source_status:'verified'},
  ]};render(<StaffSalaryScreen/>);
  expect(screen.getByRole('heading',{name:'11/2026 · 5.000.000đ'})).toBeVisible();
  expect(screen.getByRole('heading',{name:'11/2026 · 200.000đ · Bổ sung'})).toBeVisible();
  expect(screen.getByText('Bổ sung cho phiếu gốc cùng kỳ · phiếu gốc giữ nguyên.')).toBeVisible();
 });
 it('shows a pending supplement separately from approved receipts',()=>{
  f.error=false;f.employment='full_time';ft.query={isError:false,refetch:f.refetch,data:[],pendingAdjustments:[{id:'request',base_run_id:'base',period_year:2026,period_month:11,amount_vnd:200000}]};
  render(<StaffSalaryScreen/>);expect(screen.getByText('11/2026 · 200.000đ · Chờ chủ CLB duyệt')).toBeVisible();
  expect(screen.getByText('Đề nghị bổ sung sau checkout · chưa được duyệt hoặc ghi chi.')).toBeVisible();
 });
});
