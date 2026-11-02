import {createElement,type PropsWithChildren} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbGuestOrder:true}}));
import {useFnbGuestOrderStatus} from './useFnbGuest';
const orderId='10000000-0000-4000-8000-000000000003';
const valid={status:'ok',order:{id:orderId,order_status:'pending',subtotal_vnd:10000,payment_method:'cash',reference_code:null,guest_seat:3,created_at:'2026-10-21T12:00:00Z',paid_at:null,expires_at:'2026-10-21T12:30:00Z'},bank:null};
let client:QueryClient;
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return renderHook(()=>useFnbGuestOrderStatus('LOCAL-TEST343',orderId),{wrapper:({children}:PropsWithChildren)=>createElement(QueryClientProvider,{client},children)});}
afterEach(()=>{cleanup();client?.clear();rpc.mockReset();});
it.each([null,{...valid,order:{...valid.order,id:'10000000-0000-4000-8000-000000000004'}},{...valid,order:{...valid.order,subtotal_vnd:-1}},{...valid,order:{...valid.order,order_status:'invented'}},{...valid,status:'error'},{...valid,bank_source:'invented'}])('rejects unverified order status %j',async data=>{
 rpc.mockResolvedValue({data,error:null});const {result}=mount();
 await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();
});
it('accepts exact receipt status and does not mutate',async()=>{
 rpc.mockResolvedValue({data:valid,error:null});const {result}=mount();
 await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toMatchObject({order:valid.order,bank:null});
 expect(rpc).toHaveBeenCalledWith('fnb_guest_order_status',{p_token:'LOCAL-TEST343',p_order_id:orderId});
});
