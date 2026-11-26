import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),session:{access_token:'TEST_SOURCE'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'employee'},session:f.session,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
import {SalaryRunSource} from './SalaryRunSource';
const props={runId:'child',baseRunId:'base',staffId:'staff',clubId:'club',year:2026,month:11,netVnd:200000};
const source={version:1,staff_id:'staff',club_id:'club',period_year:2026,period_month:11,completed_days:26,pending_days:0,monthly_salary_vnd:5200000,standard_shifts_per_month:26,net_vnd:5200000};
const packet=()=>({run_id:'child',base_run_id:'base',staff_id:'staff',club_id:'club',recorded_net_vnd:200000,source_status:'verified',source});
const clients:QueryClient[]=[];
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}><SalaryRunSource {...props}/></QueryClientProvider>);}
beforeEach(()=>{f.rpc.mockReset();f.rpc.mockResolvedValue({data:packet(),error:null});});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());});
it('lazily distinguishes the saved child amount from the full-period source',async()=>{
 mount();expect(f.rpc).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Nguồn tính phiếu lương'}));
 await waitFor(()=>expect(screen.getByText(/Phiếu đang xem: 200.000/)).toBeVisible());
 expect(screen.getByText(/Thực nhận toàn kỳ theo nguồn: 5.200.000/)).toBeVisible();expect(screen.getByText(/26 công hoàn tất/)).toBeVisible();
 expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_staff_salary_run_source_v1',{p_run_id:'child'});
});
it('labels a legacy missing snapshot as unknown instead of reconstructing attendance',async()=>{
 f.rpc.mockResolvedValue({data:{...packet(),source_status:'unverified',source:null},error:null});mount();fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(screen.getByText('Phiếu cũ chưa có nguồn tính đã lưu để đối chiếu.')).toBeVisible());
 expect(screen.queryByText(/26 công/)).toBeNull();
});
it.each(['wrong-parent','wrong-club','wrong-amount','wrong-period'])('withholds mismatched private source: %s',async(kind)=>{
 const data=packet();if(kind==='wrong-parent')data.base_run_id='other';if(kind==='wrong-club')data.club_id='other';if(kind==='wrong-amount')data.recorded_net_vnd=5000000;if(kind==='wrong-period')data.source={...source,period_month:10};
 f.rpc.mockResolvedValue({data,error:null});mount();fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh'));expect(screen.queryByText(/26 công/)).toBeNull();
});
