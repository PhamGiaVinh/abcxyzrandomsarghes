import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {SalaryRow} from '@/lib/staffSalary/types';
const f=vi.hoisted(()=>({approve:vi.fn(),query:{} as any,session:{access_token:'TEST_OWNER'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner'},session:f.session})}));
vi.mock('@/hooks/staffSalary/useSalaryAdjustments',()=>({useSalaryAdjustments:()=>f.query}));
import {StaffSalaryAdjustments} from './StaffSalaryAdjustments';
const base:SalaryRow={staffId:'staff',runId:'base',fullName:'Nhân viên TEST',department:'service',employmentType:'full_time',status:'paid',netVnd:5000000,grossVnd:5000000,manualBhxhVnd:0,manualTaxVnd:0};
const props={source:'live' as const,clubId:'club',year:2026,month:11,rows:[base],canApprove:true};
beforeEach(()=>{f.approve.mockReset();f.approve.mockResolvedValue({status:'approved'});f.query={data:{requests:[{id:'request',base_run_id:'base',staff_id:'staff',amount_vnd:200000,state:'pending'}]},isPaused:false,isError:false,isLoading:false,isFetching:false,approve:{isPending:false,mutateAsync:f.approve},refetch:vi.fn()};});
afterEach(cleanup);
it('requires owner confirmation for the distinct pending amount and sends no money value',async()=>{
 render(<StaffSalaryAdjustments {...props}/>);
 expect(screen.getByText(/Đề nghị chưa phải khoản đã duyệt/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Xem và duyệt bổ sung'}));
 expect(screen.getByText(/Phiếu gốc: 5.000.000/)).toBeVisible();expect(screen.getByText(/Bổ sung: 200.000/)).toBeVisible();
 expect(f.approve).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Duyệt riêng khoản bổ sung'}));
 await waitFor(()=>expect(f.approve).toHaveBeenCalledExactlyOnceWith({requestId:'request',baseRunId:'base',staffId:'staff'}));
});
it('shows pending evidence to accountant without offering approval or payment',()=>{
 render(<StaffSalaryAdjustments {...props} canApprove={false}/>);
 expect(screen.getByText('Chờ chủ CLB duyệt · chưa ghi chi')).toBeVisible();expect(screen.queryByRole('button')).toBeNull();
});
it('refuses an unknown parent rather than displaying it as the selected staff payable',()=>{
 render(<StaffSalaryAdjustments {...props} rows={[]}/>);expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');
 expect(screen.queryByRole('button',{name:'Xem và duyệt bổ sung'})).toBeNull();
});
it('closes a captured confirmation when the selected club changes',()=>{
 const h=render(<StaffSalaryAdjustments {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Xem và duyệt bổ sung'}));
 h.rerender(<StaffSalaryAdjustments {...props} clubId="other"/>);expect(screen.queryByRole('dialog')).toBeNull();expect(f.approve).not.toHaveBeenCalled();
});
