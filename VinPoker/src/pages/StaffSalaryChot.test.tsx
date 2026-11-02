import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({monthRead:vi.fn(),markPaid:vi.fn(),month:{data:undefined as any,isError:true,isLoading:false,isFetching:false,isPaused:false,refetch:vi.fn()},clubsError:false,clubsPaused:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner'},loading:false,isClubOwner:true})}));
vi.mock('@/lib/staffSalary/dataSource',()=>({staffSalarySource:()=> 'live'}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{staffSalaryChot:true}}));
vi.mock('@/hooks/staffSalary/useStaffSalary',()=>({
 useSalaryClubs:()=>({data:[{id:'club',name:'LOCAL TEST',role:'owner'}],isLoading:false,isPaused:f.clubsPaused,isError:f.clubsError,refetch:vi.fn()}),
 useStaffSalaryMonth:(...args:unknown[])=>{f.monthRead(...args);return f.month;},
 useSalaryActions:()=>Object.fromEntries(['chot','submit','approve','reject','markPaid'].map(k=>[k,{isPending:false,mutate:k==='markPaid'?f.markPaid:vi.fn()}])),
}));
import StaffSalaryChot from './StaffSalaryChot';
beforeEach(()=>{f.monthRead.mockReset();f.markPaid.mockReset();f.clubsError=false;f.clubsPaused=false;f.month={data:undefined,isError:true,isLoading:false,isFetching:false,isPaused:false,refetch:vi.fn()};});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><StaffSalaryChot/></MemoryRouter>);
it('opens the staff month in Vietnam across the UTC year boundary',()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-12-31T17:30:00Z'));mount();
 expect(f.monthRead).toHaveBeenLastCalledWith('live','club',2027,1);
});
it('shows an unavailable report instead of zero salary and an empty verified roster',()=>{
 mount();expect(screen.getByRole('alert').textContent).toContain('Không xác minh được bảng lương');
 expect(screen.queryByText('Không có nhân viên hưởng lương trong tháng này.')).toBeNull();
 expect(screen.getByText('Chưa xác minh')).toBeTruthy();
 expect((screen.getByRole('button',{name:/Chốt lương/}) as HTMLButtonElement).disabled).toBe(true);
});
it('shows a club list read failure instead of claiming the owner has no clubs',()=>{
 f.clubsError=true;mount();expect(screen.getByRole('alert').textContent).toContain('Không tải được danh sách CLB');
 expect(screen.queryByText(/Bạn không có CLB nào/)).toBeNull();
});
it('keeps a verified zero snapshot distinguishable from unavailable data',()=>{
 f.month={...f.month,isError:false,data:{status:'approved',hasRuns:true,lockedRows:[],totalGrossVnd:0,totalNetVnd:0}};
 mount();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('Không có nhân viên hưởng lương trong tháng này.')).toBeTruthy();
 expect(screen.getByText('Đã duyệt')).toBeTruthy();
});
const pt={staffId:'staff-pt',runId:'run-pt',fullName:'PT paid daily',department:'service',employmentType:'part_time',workedMinutes:15,grossVnd:15792,netVnd:15792,manualBhxhVnd:0,manualTaxVnd:0,status:'locked'};
it.each(['month','clubs'])('hides salary and payment controls while %s read is paused',which=>{
 const ft={...pt,staffId:'ft',runId:'ft-run',fullName:'FT offline',employmentType:'full_time',netVnd:100000,grossVnd:100000};
 f.month={...f.month,isPaused:which==='month',isError:false,data:{status:'approved',hasRuns:true,lockedRows:[ft],totalGrossVnd:100000,totalNetVnd:100000}};
 f.clubsPaused=which==='clubs';mount();
 expect(screen.getByRole('status')).toHaveTextContent('Mất kết nối');
 expect(screen.queryByText('FT offline')).toBeNull();expect(screen.queryByRole('button',{name:'Đánh dấu trả'})).toBeNull();
});
it('labels an approved PT month row as an already-paid daily summary and offers no second payment',()=>{
 f.month={...f.month,isError:false,data:{status:'approved',hasRuns:true,lockedRows:[pt],totalGrossVnd:15792,totalNetVnd:15792}};mount();expect(screen.getByText(/Tổng đã trả theo ngày/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Đánh dấu trả'})).toBeNull();expect(screen.queryByText(/có thể đánh dấu đã trả từng nhân viên/)).toBeNull();expect(screen.getByText(/lương PT chỉ đối chiếu/)).toBeTruthy();expect(screen.queryByText(/PT · 0h/)).toBeNull();
});
it('keeps the payment action for an unpaid approved FT snapshot while PT remains a summary',()=>{
 const ft={...pt,staffId:'staff-ft',runId:'run-ft',fullName:'FT unpaid',employmentType:'full_time',netVnd:100000,grossVnd:100000};f.month={...f.month,isError:false,data:{status:'approved',hasRuns:true,lockedRows:[pt,ft],totalGrossVnd:115792,totalNetVnd:115792}};mount();expect(screen.getAllByRole('button',{name:'Đánh dấu trả'})).toHaveLength(1);expect(screen.getByText(/Tổng đã trả theo ngày/)).toBeTruthy();
});
