import {fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({shifts:{data:undefined as unknown,isLoading:false,isError:true,refetch:vi.fn()},report:{data:undefined as unknown,isLoading:false,isError:false,refetch:vi.fn()},rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'},session:null,loading:false})}));
vi.mock('@/hooks/useFnbShift',()=>({useFnbShifts:()=>h.shifts,useFnbShiftReport:()=>h.report}));
import {ShiftReconciliationPanel} from './ShiftReconciliationPanel';
const club='20000000-0000-4000-8000-000000000001';
const open={id:'30000000-0000-4000-8000-000000000001',club_id:club,status:'open',opened_at:'2026-10-24T08:00:00Z',opening_float_vnd:100000};
const view=()=> <QueryClientProvider client={new QueryClient()}><ShiftReconciliationPanel clubId={club} canClose/></QueryClientProvider>;
describe('F&B shift unknown is not empty or zero',()=>{
 beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async (_name:string,work:()=>unknown)=>work())}});h.shifts={data:undefined,isLoading:false,isError:true,refetch:vi.fn()};h.report={data:undefined,isLoading:false,isError:false,refetch:vi.fn()};h.rpc.mockReset();});
 it.each([false,true])('blocks cash actions for a failed shift-list read (cached=%s)',cached=>{
  if(cached)h.shifts.data={open,recent:[open]};render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được danh sách ca');
  expect(screen.queryByText('Chưa có ca đang mở')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Mở ca'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Chốt ca'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại ca'}));expect(h.shifts.refetch).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('does not show zero totals or close a shift when its report fails',()=>{
  h.shifts={...h.shifts,data:{open,recent:[open]},isError:false};h.report.isError=true;render(view());
  expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được số liệu ca');
  expect(screen.queryByText('Doanh thu (đã thu)')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Chốt ca'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại số liệu ca'}));expect(h.report.refetch).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('shows pending report explicitly instead of provisional zero totals',()=>{
  h.shifts={...h.shifts,data:{open,recent:[open]},isError:false};h.report.isLoading=true;render(view());
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải số liệu ca');
  expect(screen.queryByText('Doanh thu (đã thu)')).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();
 });
 it('permits opening only after a verified empty list',()=>{
  h.shifts={...h.shifts,data:{open:null,recent:[]},isError:false};render(view());
  expect(screen.getByText('Chưa có ca đang mở')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Mở ca'})).toBeEnabled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('recovers the close form only after a verified report, including genuine zero totals',()=>{
  h.shifts={...h.shifts,data:{open,recent:[open]},isError:false};h.report.isError=true;
  const page=render(view());expect(screen.getByRole('alert')).toBeInTheDocument();
  h.report={...h.report,isError:false,data:{shift:open,sales_vnd:0,refunds_vnd:0,expected_cash_vnd:0,expected_drawer_vnd:100000,comp_count:0,orders:[]}};
  page.rerender(view());expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Doanh thu (đã thu)')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Chốt ca'})).toBeEnabled();expect(h.rpc).not.toHaveBeenCalled();
 });
});
