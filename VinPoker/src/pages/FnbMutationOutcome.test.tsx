import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),changed:vi.fn(),session:{access_token:'TEST_CREDENTIAL_A'},actor:'10000000-0000-4000-8000-000000000001',club:'20000000-0000-4000-8000-000000000001'}));
const order={id:'50000000-0000-4000-8000-000000000001',club_id:'20000000-0000-4000-8000-000000000001',status:'paid' as const,source:'table',table_label:'TEST',customer_name:null,note:null,
 subtotal_vnd:50000,cogs_vnd:0,created_at:'2026-10-18T00:00:00Z',paid_at:null,table_ref:null,guest_seat:null,payment_method:'cash',
 items:[{id:'line-test',order_id:'order-test',menu_item_id:'menu-test',name_snapshot:'TEST coffee',qty:1,unit_price_snapshot:50000,line_status:'paid' as const}]};
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session,loading:false,isClubOwner:true,isAdmin:false,isFnb:true,isFnbCashier:true,isFnbServer:true})}));
vi.mock('@/hooks/useFnbClubs',()=>({useFnbClubs:()=>({loading:false,clubs:[{id:h.club,name:'TEST'}],error:null,reload:vi.fn()})}));
vi.mock('@/hooks/useFnbServe',()=>({useFnbServeQueue:()=>({data:[order],isLoading:false,isError:false,refetch:vi.fn()})}));
vi.mock('@/hooks/useFnbLinkTargets',()=>({useFnbLinkTargets:()=>({data:undefined})}));
vi.mock('@/hooks/useFnbOrders',()=>({useFnbOrders:()=>({data:[order],isLoading:false,isError:false,refetch:vi.fn()})}));
vi.mock('@/components/fnb/OrderEntryPanel',()=>({OrderEntryPanel:({resetKey,onSubmit,onSubmitComp,submitting}:{resetKey:number;onSubmit:(o:unknown)=>void;onSubmitComp:(o:unknown)=>void;submitting:boolean})=>{
 const cart={table_label:'TEST',customer_name:null,note:null,client_request_id:'30000000-0000-4000-8000-000000000001',items:[{menu_item_id:'40000000-0000-4000-8000-000000000001',qty:1,name_snapshot:'TEST coffee',unit_price_snapshot:50000}],subtotal_vnd:50000};
 return <><button disabled={submitting} onClick={()=>onSubmit(cart)}>Create cart {resetKey}</button><button onClick={()=>onSubmitComp(cart)}>Comp cart {resetKey}</button></>;
}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbModule:true,fnbGuestOrder:true,fnbCounter:true,fnbComp:true}}));
import FnbServe from './FnbServe';
import FnbCounter from './FnbCounter';
import {KitchenTicket} from '@/components/fnb/KitchenTicket';

// The new boundary requires both a write outcome and an actor/payload-bound read receipt.
// These remain mocked component tests, not native acceptance evidence.
function respondCreate(data:unknown,verified:boolean,throwWrite=false){
 h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='fnb_get_create_receipt_v1'){
   if(!verified)return Promise.resolve({data:null,error:null});
   const call=h.rpc.mock.calls.find(([called])=>called==='fnb_create_order'||called==='fnb_create_comp_order')!;
   const p=call[1] as Record<string,unknown>,comp=call[0]==='fnb_create_comp_order';
   return Promise.resolve({data:{status:'found',actor_id:h.actor,club_id:h.club,request_id:args.p_request_id,operation:comp?'comp':'order',
    intent:{source:p.p_source,table:p.p_table_label,customer:p.p_customer_name,note:p.p_note,lines:p.p_lines,
     ...(comp?{reason:p.p_comp_reason}:{table_ref:p.p_table_ref,player_ref:p.p_player_ref})},
    order:{id:order.id,status:comp?'paid':'pending',subtotal_vnd:50000,is_comp:comp}},error:null});
  }
  return throwWrite?Promise.reject(new Error('Failed to fetch')):Promise.resolve({data,error:null});
 });
}
describe('F&B order mutations require an explicit matching server outcome',()=>{
 beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_name:string,work:()=>unknown)=>work())}});
  h.rpc.mockReset();h.success.mockReset();h.error.mockReset();h.changed.mockReset();h.session={access_token:'TEST_CREDENTIAL_A'};h.actor='10000000-0000-4000-8000-000000000001';h.club='20000000-0000-4000-8000-000000000001';});
 it('explains a legacy partial-return refusal without claiming the order was cancelled',async()=>{
 h.rpc.mockResolvedValue({data:{error:'PARTIAL_RETURN_SNAPSHOT_UNAVAILABLE'},error:null});
 render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><FnbCounter/></QueryClientProvider></MemoryRouter>);
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Đã thu'}),{button:0,ctrlKey:false});
 fireEvent.click(await screen.findByRole('button',{name:'Huỷ / Hoàn'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith('Đơn cũ đã giao một phần nhưng thiếu dữ liệu nguyên liệu lúc thu tiền. Cần đối soát hàng trả trước khi huỷ; đơn chưa bị thay đổi.'));
 expect(h.success).not.toHaveBeenCalled();
});
 it('kitchen keeps mobile completion controls at the shared 44px touch minimum',()=>{
  render(<KitchenTicket order={order} onChanged={h.changed}/>);
  for(const name of ['Xong','Tất cả xong']){
   const button=screen.getByRole('button',{name});
   expect(button.classList.contains('min-h-11')).toBe(true);
   expect(button.classList.contains('min-w-11')).toBe(true);
  }
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('kitchen unknown-line denial tells the operator to reload and does not report shipping success',async()=>{
  h.rpc.mockResolvedValue({data:{error:'LINE_NOT_FOUND'},error:null});
  render(<KitchenTicket order={order} onChanged={h.changed}/>);
  fireEvent.click(screen.getByRole('button',{name:'Xong'}));
  await waitFor(()=>expect(h.error).toHaveBeenCalled());
  expect(h.error.mock.lastCall?.[0]).toMatch(/dòng món.*[Tt]ải lại/);
  expect(h.changed).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 });
 for(const scope of ['actor','club'] as const){
  it(`counter closes old payment intent when ${scope} changes`,()=>{
   const client=new QueryClient();const view=()=> <MemoryRouter><QueryClientProvider client={client}><FnbCounter/></QueryClientProvider></MemoryRouter>;
   const mounted=render(view());
   fireEvent.mouseDown(screen.getByRole('tab',{name:'Chờ thanh toán'}),{button:0,ctrlKey:false});
   fireEvent.click(screen.getByRole('button',{name:'Thu tiền'}));
   expect(screen.getByRole('dialog')).toBeTruthy();
   h[scope]=scope==='actor'?'10000000-0000-4000-8000-000000000002':'20000000-0000-4000-8000-000000000002';mounted.rerender(view());
   expect(screen.queryByRole('dialog')).toBeNull();expect(h.rpc).not.toHaveBeenCalled();
  });
  it(`counter ignores old create completion after ${scope} changes`,async()=>{
   let resolve!:(value:unknown)=>void;h.rpc.mockReturnValue(new Promise(r=>{resolve=r;}));
   const client=new QueryClient();const view=()=> <MemoryRouter><QueryClientProvider client={client}><FnbCounter/></QueryClientProvider></MemoryRouter>;
   const mounted=render(view());fireEvent.click(screen.getByRole('button',{name:'Create cart 0'}));
   await waitFor(()=>expect(h.rpc).toHaveBeenCalled());
   h[scope]=scope==='actor'?'10000000-0000-4000-8000-000000000002':'20000000-0000-4000-8000-000000000002';mounted.rerender(view());
   await act(async()=>resolve({data:{status:'ok',order_id:order.id,idempotent:false,subtotal_vnd:50000},error:null}));
   expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:'Create cart 0'})).toBeTruthy();
   expect(h.success).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();
  });
 }
 for(const credential of ['replacement','in-place']){
  it(`counter fences an old create after same-actor credential ${credential}`,async()=>{
   let finish!:(value:unknown)=>void;h.rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
   const client=new QueryClient();const view=()=> <MemoryRouter><QueryClientProvider client={client}><FnbCounter/></QueryClientProvider></MemoryRouter>;
   const page=render(view());fireEvent.click(screen.getByRole('button',{name:'Create cart 0'}));
   await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));
   if(credential==='replacement')h.session={access_token:'TEST_CREDENTIAL_B'};else h.session.access_token='TEST_CREDENTIAL_B';
   page.rerender(view());await act(async()=>finish({data:{status:'ok',order_id:order.id,idempotent:false,subtotal_vnd:50000},error:null}));
   expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(h.success).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();
   expect(screen.getByRole('button',{name:'Đối chiếu đơn'})).toBeEnabled();expect(h.rpc).toHaveBeenCalledTimes(1);
   expect(Object.values(localStorage).join('')).not.toContain('TEST_CREDENTIAL');
  });
 }
 for(const outcome of ['null','missing-comp','throw','confirmed']){
  it(`counter COMP ${outcome} requires a comp receipt before clearing cart`,async()=>{
   respondCreate(outcome==='null'?null:{status:'ok',order_id:order.id,idempotent:false,...(outcome==='confirmed'?{is_comp:true}:{})},outcome==='confirmed',outcome==='throw');
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><FnbCounter/></QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:'Comp cart 0'}));
   fireEvent.click(screen.getByRole('button',{name:'Xác nhận COMP'}));
   const confirmed=outcome==='confirmed';
   await waitFor(()=>expect(confirmed?h.success:h.error).toHaveBeenCalledTimes(1));
   expect(screen.getByRole('button',{name:`Comp cart ${confirmed?1:0}`,hidden:true})).toBeTruthy();
   if(!confirmed){expect(h.success).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Gửi lại cùng mã đơn'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Xác nhận COMP'})).not.toBeInTheDocument();}
  });
 }
 for(const outcome of ['null','unknown','throw','confirmed','replayed']){
  it(`counter create ${outcome} preserves cart identity until confirmed`,async()=>{
   respondCreate(outcome==='null'?null:outcome==='unknown'?{ok:true}:{status:'ok',order_id:order.id,idempotent:outcome==='replayed',...(outcome==='confirmed'?{subtotal_vnd:50000}:{})},outcome==='confirmed'||outcome==='replayed',outcome==='throw');
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><FnbCounter/></QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:'Create cart 0'}));
   const confirmed=outcome==='confirmed'||outcome==='replayed';
   await waitFor(()=>expect(confirmed?h.success.mock.calls.length||screen.queryByRole('dialog'):h.error.mock.calls.length).toBeTruthy());
   expect(screen.getByRole('button',{name:`Create cart ${confirmed?1:0}`,hidden:true}).hasAttribute('disabled')).toBe(!confirmed);
   if(!confirmed){expect(h.success).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalled();}
   if(outcome==='confirmed')expect(screen.getByRole('dialog')).toBeTruthy();
   else expect(screen.queryByRole('dialog')).toBeNull();
  });
 }
 for(const action of ['pay','cancel']){
  for(const outcome of ['null','wrong-order','throw','confirmed']){
   it(`counter ${action} handles ${outcome} without false success or stuck busy`,async()=>{
    if(outcome==='throw')h.rpc.mockRejectedValue(new Error('Failed to fetch'));
    else h.rpc.mockResolvedValue({data:outcome==='null'?null:{status:'ok',order_id:outcome==='wrong-order'?'other':order.id},error:null});
    render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><FnbCounter/></QueryClientProvider></MemoryRouter>);
    fireEvent.mouseDown(screen.getByRole('tab',{name:'Chờ thanh toán'}),{button:0,ctrlKey:false});
    if(action==='pay'){
     fireEvent.click(await screen.findByRole('button',{name:'Thu tiền'}));
     fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Thu tiền'}));
    }else fireEvent.click(await screen.findByRole('button',{name:'Huỷ'}));
    await waitFor(()=>expect(outcome==='confirmed'?h.success:h.error).toHaveBeenCalledTimes(1));
    if(outcome!=='confirmed')expect(h.success).not.toHaveBeenCalled();
    if(action==='cancel')expect(screen.getByRole('button',{name:'Huỷ'}).hasAttribute('disabled')).toBe(false);
    else if(outcome!=='confirmed')expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Thu tiền'}).hasAttribute('disabled')).toBe(false);
   });
  }
 }
 for(const committed of [false,true]){
  it(`counter intent cancel ${committed?'recovers committed order without undo':'requires a verified fence before enabling a new cart'}`,async()=>{
   let original:Record<string,unknown>={};
   h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
    if(name==='fnb_create_order'){original=args;return Promise.resolve({data:null,error:{message:'503'}});}
    const intent={source:original.p_source,table:original.p_table_label,customer:original.p_customer_name,note:original.p_note,lines:original.p_lines,table_ref:original.p_table_ref,player_ref:original.p_player_ref};
    const context={actor_id:h.actor,club_id:h.club,request_id:original.p_client_request_id};
    if(name==='fnb_cancel_create_intent_v1')return Promise.resolve({data:{...context,status:committed?'found':'cancelled',operation:'order',intent,
     ...(committed?{order:{id:order.id,status:'pending',is_comp:false,subtotal_vnd:50000}}:{})},error:null});
    return Promise.resolve({data:{...context,status:'not_found'},error:null});
   });
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><FnbCounter/></QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:'Create cart 0'}));
   await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'})).toBeEnabled());
   expect(screen.getByRole('button',{name:'Create cart 0'})).toBeDisabled();
   fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'}));
   await waitFor(()=>expect(h.success).toHaveBeenCalledTimes(1));
   expect(h.success.mock.lastCall?.[0]).toContain(committed?'Đã đối chiếu đơn':'Đã hủy yêu cầu chưa ghi');
   expect(screen.getByRole('button',{name:'Create cart 1'})).toBeEnabled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
   expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_create_order')).toHaveLength(1);
   expect(h.rpc.mock.calls.filter(([name])=>name==='fnb_mark_paid'||name==='fnb_cancel_order')).toHaveLength(0);
  });
 }
 for(const surface of ['serve','kitchen']){
  it(`${surface} accepts the canonical matching success and replay shape`,async()=>{
   h.rpc.mockResolvedValue({data:{status:'ok',order_id:order.id,idempotent:true,all_shipped:true},error:null});
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{surface==='serve'?<FnbServe/>:<KitchenTicket order={order} onChanged={h.changed}/>}</QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:surface==='serve'?'Đã thu tiền mặt':'Tất cả xong'}));
   await waitFor(()=>expect(surface==='serve'?h.success:h.changed).toHaveBeenCalledTimes(1));expect(h.error).not.toHaveBeenCalled();
  });
  it(`${surface} preserves the server business denial`,async()=>{
   h.rpc.mockResolvedValue({data:{error:'BAD_STATE',status:'cancelled'},error:null});
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{surface==='serve'?<FnbServe/>:<KitchenTicket order={order} onChanged={h.changed}/>}</QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:surface==='serve'?'Đã thu tiền mặt':'Tất cả xong'}));
   await waitFor(()=>expect(h.error).toHaveBeenCalledWith('Đơn không ở trạng thái phù hợp để thao tác.'));expect(h.success).not.toHaveBeenCalled();expect(h.changed).not.toHaveBeenCalled();
  });
  for(const [name,data] of [['null',null],['unknown',{ok:true}],['wrong-order',{status:'ok',order_id:'other'}]] as const){
   it(`${surface} does not claim ${name} response succeeded`,async()=>{
    h.rpc.mockResolvedValue({data,error:null});
    render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{surface==='serve'?<FnbServe/>:<KitchenTicket order={order} onChanged={h.changed}/>}</QueryClientProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:surface==='serve'?'Đã thu tiền mặt':'Tất cả xong'}));
    await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();expect(h.changed).not.toHaveBeenCalled();
   });
  }
  it(`${surface} releases busy state on thrown transport failure`,async()=>{
   h.rpc.mockRejectedValue(new Error('Failed to fetch'));
   render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{surface==='serve'?<FnbServe/>:<KitchenTicket order={order} onChanged={h.changed}/>}</QueryClientProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole('button',{name:surface==='serve'?'Đã thu tiền mặt':'Tất cả xong'}));
   await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(screen.getByRole('button',{name:surface==='serve'?'Đã thu tiền mặt':'Tất cả xong'}).hasAttribute('disabled')).toBe(false);
   expect(h.success).not.toHaveBeenCalled();expect(h.changed).not.toHaveBeenCalled();
  });
 }
});
