vi.mock("@/hooks/useOperationalCapabilities", () => ({ useOperationalCapabilities: () => ({ loading: false, error: false, allows: () => true, hasFacet: () => true }) }));
import {fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({error:true,loading:false,data:undefined as unknown[]|undefined,refetch:vi.fn(),rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'},session:null,loading:false,isClubOwner:true,isAdmin:false,isFnb:true,isFnbCashier:true,isFnbServer:true})}));
vi.mock('@/hooks/useFnbClubs',()=>({useFnbClubs:()=>({loading:false,clubs:[{id:'20000000-0000-4000-8000-000000000001',name:'TEST A'}],error:null,reload:vi.fn()})}));
vi.mock('@/hooks/useFnbKitchen',()=>({useFnbKitchen:()=>({data:h.data,isLoading:h.loading,isError:h.error,refetch:h.refetch})}));
vi.mock('@/hooks/useFnbServe',()=>({useFnbServeQueue:()=>({data:h.data,isLoading:false,isError:h.error,refetch:h.refetch})}));
vi.mock('@/hooks/useFnbOrders',()=>({useFnbOrders:()=>({data:h.data,isLoading:false,isError:h.error,refetch:h.refetch})}));
vi.mock('@/components/fnb/OrderEntryPanel',()=>({OrderEntryPanel:()=>null}));
vi.mock('@/hooks/useFnbLinkTargets',()=>({useFnbLinkTargets:()=>({data:undefined})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbModule:true,fnbCounter:true,fnbKitchen:true,fnbGuestOrder:true}}));
import FnbServe from './FnbServe';
import FnbKitchenDisplay from './FnbKitchenDisplay';
import FnbCounter from './FnbCounter';
const staleOrder={id:'order-a',club_id:'club-a',status:'paid',source:'table',payment_method:'cash',table_label:'TEST TABLE',
 customer_name:'STALE TEST GUEST',subtotal_vnd:50000,paid_at:null,note:null,table_ref:null,
 items:[{id:'line-a',qty:1,name_snapshot:'TEST item',line_status:'paid'}]};
describe('F&B queues never treat a failed read as a confirmed empty queue',()=>{
 beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_name:string,work:()=>unknown)=>work())}});h.error=true;h.loading=false;h.data=undefined;h.refetch.mockReset();h.rpc.mockReset();});
 it('kitchen does not label an unverified loading queue as zero',()=>{
  h.error=false;h.loading=true;
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const {rerender}=render(<MemoryRouter><QueryClientProvider client={client}><FnbKitchenDisplay/></QueryClientProvider></MemoryRouter>);
  const badge=()=>screen.getByRole('heading',{name:'Bếp · Đơn đã thu'}).parentElement?.querySelector('span');
  expect(badge()).toHaveTextContent('—');
  expect(screen.getByText('Đang tải…')).toBeInTheDocument();
  h.loading=false;h.data=[];
  rerender(<MemoryRouter><QueryClientProvider client={client}><FnbKitchenDisplay/></QueryClientProvider></MemoryRouter>);
  expect(badge()).toHaveTextContent('0');
 });
 for(const [name,Page] of Object.entries({serve:FnbServe,kitchen:FnbKitchenDisplay,counter:FnbCounter})){
  for(const cached of [false,true])it(`${name}: ${cached?'cached':'cold'} read error hides actionable orders, retry can recover`,()=>{
   h.data=cached?[staleOrder]:undefined;
   const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
   const view=()=> <MemoryRouter><QueryClientProvider client={client}><Page/></QueryClientProvider></MemoryRouter>;
   const {rerender}=render(view());
   if(name==='counter')fireEvent.mouseDown(screen.getByRole('tab',{name:'Chờ thanh toán'}),{button:0,ctrlKey:false});
   expect(screen.getByRole('alert').textContent).toContain('Không tải được danh sách đơn');
   expect(screen.queryByText(/Chưa có đơn nào/)).toBeNull();
   expect(screen.queryByText('STALE TEST GUEST')).toBeNull();
   expect(screen.queryByRole('button',{name:'Đã thu tiền mặt'})).toBeNull();
   expect(screen.queryByRole('button',{name:'Tất cả xong'})).toBeNull();
   expect(screen.queryByRole('button',{name:'Thu tiền'})).toBeNull();
   fireEvent.click(screen.getByRole('button',{name:'Thử tải lại đơn'}));expect(h.refetch).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();
   h.error=false;h.data=[];rerender(view());
   expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText(name==='counter'?'Không có đơn chờ thanh toán.':/Chưa có đơn nào/)).toBeTruthy();
  });
 }
});
