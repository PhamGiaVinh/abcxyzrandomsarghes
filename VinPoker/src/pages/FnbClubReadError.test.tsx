vi.mock("@/hooks/useOperationalCapabilities", () => ({ useOperationalCapabilities: () => ({ loading: false, error: false, allows: () => true, hasFacet: () => true }) }));
import {fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({reload:vi.fn(),message:'Không tải được danh sách CLB F&B. Hãy thử lại; chưa thể xác minh phân công.'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn(),from:vi.fn(),channel:vi.fn()}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({loading:false,isClubOwner:true,isAdmin:false,isFnb:true,isFnbCashier:true,isFnbServer:true})}));
vi.mock('@/hooks/useFnbClubs',()=>({useFnbClubs:()=>({loading:false,clubs:null,error:h.message,reload:h.reload})}));
vi.mock('@/hooks/useFnbKitchen',()=>({useFnbKitchen:()=>({data:undefined,isLoading:false,refetch:vi.fn()})}));
vi.mock('@/hooks/useFnbLinkTargets',()=>({useFnbLinkTargets:()=>({data:undefined})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbModule:true,fnbCounter:true,fnbKitchen:true,fnbGuestOrder:true}}));
import FnbCounter from './FnbCounter';
import FnbAdmin from './FnbAdmin';
import FnbServe from './FnbServe';
import FnbKitchenDisplay from './FnbKitchenDisplay';
describe('F&B pages distinguish unavailable club reads from no assignment',()=>{
 beforeEach(()=>h.reload.mockReset());
 for(const [name,Page] of Object.entries({counter:FnbCounter,admin:FnbAdmin,serve:FnbServe,kitchen:FnbKitchenDisplay})){
  it(`${name} shows an explicit error and retry, not an empty queue or denial`,()=>{
   render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Page/></QueryClientProvider></MemoryRouter>);
   expect(screen.getByRole('alert').textContent).toContain(h.message);
   expect(screen.queryByText(/Bạn chưa.*(?:gán|sở hữu)/)).toBeNull();
   expect(screen.queryByText('Chưa có đơn nào')).toBeNull();
   fireEvent.click(screen.getByRole('button',{name:'Thử tải lại CLB'}));expect(h.reload).toHaveBeenCalledTimes(1);
  });
 }
});
