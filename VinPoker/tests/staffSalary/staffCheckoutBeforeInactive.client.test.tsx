import {createElement,type ReactNode} from 'react';
import {act,cleanup,renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error}}));
import {useStaffUpsert} from '@/hooks/accountant/useStaffDirectory';
const input={staffId:'staff',fullName:'TEST',department:'service' as const,employmentType:'full_time' as const,monthlySalaryVnd:2600000,status:'inactive' as const};
const detail='Nhân viên cần check-out hết ca đang mở trước khi chuyển sang ngừng hoạt động.';
beforeEach(()=>vi.clearAllMocks());afterEach(()=>cleanup());
function setup(){const client=new QueryClient({defaultOptions:{mutations:{retry:false},queries:{retry:false,gcTime:0}}});const invalidate=vi.spyOn(client,'invalidateQueries');const wrapper=({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);return{...renderHook(()=>useStaffUpsert('club'),{wrapper}),invalidate,client};}
it('surfaces checkout-required server detail without success or cache invalidation',async()=>{
 f.rpc.mockResolvedValue({data:{error:'STAFF_CHECKOUT_REQUIRED',detail},error:null});const v=setup();try{await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow(detail);});expect(f.error).toHaveBeenCalledWith(detail);expect(f.success).not.toHaveBeenCalled();expect(v.invalidate).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls[0][1]).toMatchObject({p_club_id:'club',p_staff_id:'staff',p_status:'inactive'});}finally{v.unmount();v.client.clear();}
});
it('allows explicit retry after checkout and invalidates only on confirmed success',async()=>{
 f.rpc.mockResolvedValueOnce({data:{error:'STAFF_CHECKOUT_REQUIRED',detail},error:null}).mockResolvedValueOnce({data:{status:'ok',staff_id:'staff',club_id:'club'},error:null});const v=setup();try{await act(async()=>{await expect(v.result.current.mutateAsync(input)).rejects.toThrow(detail);});expect(v.invalidate).not.toHaveBeenCalled();await act(async()=>{await v.result.current.mutateAsync(input);});expect(f.rpc).toHaveBeenCalledTimes(2);expect(f.success).toHaveBeenCalledTimes(1);expect(v.invalidate).toHaveBeenCalledWith({queryKey:['accountant','staffDirectory','club']});}finally{v.unmount();v.client.clear();}
});
