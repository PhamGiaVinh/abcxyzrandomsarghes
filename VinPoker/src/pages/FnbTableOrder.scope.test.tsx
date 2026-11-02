import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Link,MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const {create,read,status,menu,abandon}=vi.hoisted(()=>({create:vi.fn(),read:vi.fn(),status:vi.fn(),menu:vi.fn(),abandon:vi.fn()}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbModule:true,fnbGuestOrder:true}}));
vi.mock('@/hooks/useFnbGuest',()=>({
 useFnbGuestLookup:(token:string)=>menu(token)??({isLoading:false,error:null,data:{club_name:`Club ${token}`,table_name:`Table ${token}`,bank_available:false,categories:[],items:[]}}),
 useFnbGuestOrderStatus:()=>status()??{data:undefined},fnbGuestCreateOrder:create,fnbGuestReadReceipt:read,fnbGuestAbandonIntent:abandon,
}));
import FnbTableOrder from './FnbTableOrder';
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();create.mockReset();read.mockReset();status.mockReset();menu.mockReset();abandon.mockReset();});
it('resets local seat and order phase when another table QR token is opened',()=>{
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><Link to="/fnb/order?t=TEST-B">Other TEST table</Link><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'3'}));
 fireEvent.click(screen.getByRole('button',{name:'Xem thực đơn'}));
 expect(screen.queryByText('Bạn ngồi ghế số mấy?')).toBeNull();
 fireEvent.click(screen.getByRole('link',{name:'Other TEST table'}));
 expect(screen.getByText('Table TEST-B')).toBeInTheDocument();
 expect(screen.getByText('Bạn ngồi ghế số mấy?')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Xem thực đơn'})).toBeInTheDocument();
 expect(create).not.toHaveBeenCalled();
});
const intent={version:1,token:'TEST-A',requestId:'10000000-0000-4000-8000-000000000001',seat:3,customerName:'TEST',note:null,lines:[{menu_item_id:'10000000-0000-4000-8000-000000000002',qty:1}],paymentMethod:'cash'};
it('recovers pending journal by read-only receipt after reload',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));
 const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,bank:null,expires_at:'2026-10-21T12:00:00Z'};
 read.mockResolvedValue({kind:'found',receipt});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByText('Đã gửi đơn!')).toBeInTheDocument());
 expect(read).toHaveBeenCalledWith(intent);expect(create).not.toHaveBeenCalled();
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toMatchObject({resolved:true,receipt});
});
it('keeps unknown pending journal blocked without creating another order',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));read.mockResolvedValue({kind:'unknown'});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra đơn đã gửi'})).toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Xem thực đơn'})).toBeNull();
 expect(create).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toEqual(intent);
});
it('offers explicit exact-intent retry only after confirmed missing and guards double click',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));read.mockResolvedValue({kind:'missing'});
 let finish!:(value:unknown)=>void;create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 const retry=await screen.findByRole('button',{name:'Gửi lại đúng đơn đã lưu'});
 expect(create).not.toHaveBeenCalled();fireEvent.click(retry);fireEvent.click(retry);
 expect(create).toHaveBeenCalledTimes(1);
 expect(create).toHaveBeenCalledWith({token:intent.token,seat:intent.seat,customerName:intent.customerName,note:intent.note,lines:intent.lines,paymentMethod:intent.paymentMethod,clientRequestId:intent.requestId});
 finish({res:null,errorCode:'FNB_MUTATION_UNKNOWN'});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Gửi lại đúng đơn đã lưu'})).toBeNull());
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toEqual(intent);
});
it('does not write a late receipt after leaving its QR scope',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));
 let finish!:(value:unknown)=>void;read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><Link to="/fnb/order?t=TEST-B">Other TEST table</Link><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(screen.getByRole('link',{name:'Other TEST table'}));
 await act(async()=>{finish({kind:'found',receipt:{status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,bank:null,expires_at:'2026-10-21T12:00:00Z'}});});
 expect(screen.getByText('Table TEST-B')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Xem thực đơn'})).toBeInTheDocument();
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toEqual(intent);
 expect(localStorage.getItem('fnb.guest.intent.v1.TEST-B')).toBeNull();expect(create).not.toHaveBeenCalled();
});
it('blocks corrupt journal without issuing receipt or create requests',()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A','{');
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được đơn đã lưu');
 expect(screen.queryByRole('button',{name:'Xem thực đơn'})).toBeNull();
 expect(read).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
function savedOrder(){localStorage.setItem('fnb.guest.order.TEST-A',JSON.stringify({status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,bank:null,expires_at:'2026-10-21T12:00:00Z'}));}
it('distinguishes cancelled from expired order',()=>{
 savedOrder();status.mockReturnValue({data:{order:{order_status:'cancelled'}}});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByText('Đơn đã hủy')).toBeInTheDocument();expect(screen.queryByText('Đơn đã hết hạn')).toBeNull();
 expect(create).not.toHaveBeenCalled();
});
it('does not present status fetch failure as currently pending or allow reorder',()=>{
 savedOrder();const refetch=vi.fn();status.mockReturnValue({data:undefined,error:Error('TEST503'),refetch});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được trạng thái đơn');
 expect(screen.queryByText('Đã gửi đơn!')).toBeNull();expect(screen.queryByRole('button',{name:'Gọi lại'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Tải lại trạng thái'}));expect(refetch).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled();
});
function prepareReview(){
 menu.mockReturnValue({isLoading:false,error:null,data:{club_name:'TEST',table_name:'TEST table',bank_available:false,categories:[],items:[{id:intent.lines[0].menu_item_id,name:'TEST coffee',price_vnd:10000,category_id:null,image_url:null,sort_order:0}]}});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Xem thực đơn'}));fireEvent.click(screen.getByRole('button',{name:/^(?:Thêm TEST coffee)?$/}));
 fireEvent.click(screen.getByRole('button',{name:/Xem đơn \(1 món\)/}));
}
it('does not dispatch an order if durable storage fails',()=>{
 prepareReview();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('TEST quota');});
 fireEvent.click(screen.getByRole('button',{name:'Gửi đơn — trả tiền mặt'}));
 expect(create).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Chưa gửi đơn');
});
it('persists exact request before first dispatch and prevents duplicate clicks',()=>{
 prepareReview();create.mockImplementation(args=>{
  const journal=JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!);
  expect(journal).toMatchObject({requestId:args.clientRequestId,token:args.token,seat:args.seat,lines:args.lines,paymentMethod:args.paymentMethod});
  return new Promise(()=>{});
 });
 const send=screen.getByRole('button',{name:'Gửi đơn — trả tiền mặt'});fireEvent.click(send);fireEvent.click(send);
 expect(create).toHaveBeenCalledTimes(1);
});
it('offers read-only recovery from lookup failure without sending an order',()=>{
 const refetch=vi.fn();menu.mockReturnValue({data:undefined,isLoading:false,isFetching:false,error:Error('TEST503'),refetch});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Tải lại thực đơn'}));
 expect(refetch).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled();
});
it('caps guest quantity at the existing server limit before review',()=>{
 prepareReview();fireEvent.click(screen.getByRole('button',{name:'Quay lại thực đơn'}));
 const plus=screen.getAllByRole('button',{name:/^(?:Thêm TEST coffee)?$/}).at(-1)!;
 for(let n=0;n<20;n++)fireEvent.click(plus);
 expect(screen.getByRole('button',{name:/Xem đơn \(20 món\)/})).toBeInTheDocument();
 expect(plus).toBeDisabled();expect(create).not.toHaveBeenCalled();
});
it('caps distinct items at thirty but permits increasing or removing an existing item',()=>{
 const items=Array.from({length:31},(_,n)=>({id:`10000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,name:`TEST item ${n+1}`,price_vnd:10000,category_id:null,image_url:null,sort_order:n}));
 menu.mockReturnValue({isLoading:false,error:null,data:{club_name:'TEST',table_name:'TEST',bank_available:false,categories:[],items}});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Xem thực đơn'}));
 for(let n=1;n<=30;n++)fireEvent.click(screen.getByRole('button',{name:`Thêm TEST item ${n}`}));
 expect(screen.getByRole('button',{name:'Thêm TEST item 31'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Thêm TEST item 2'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Giảm TEST item 1'}));
 expect(screen.getByRole('button',{name:'Thêm TEST item 31'})).toBeEnabled();expect(create).not.toHaveBeenCalled();
});
it('requires an explicit bound server fence before permitting choose again',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));read.mockResolvedValue({kind:'unknown'});
 const fence={error:'REQUEST_ABANDONED',request_id:intent.requestId,idempotent:true};abandon.mockResolvedValue({kind:'abandoned',receipt:fence});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 const close=await screen.findByRole('button',{name:'Đóng yêu cầu cũ để chọn lại món'});
 expect(abandon).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Chọn lại món'})).toBeNull();
 fireEvent.click(close);await screen.findByRole('button',{name:'Chọn lại món'});
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toMatchObject({resolved:true,receipt:fence});
 fireEvent.click(screen.getByRole('button',{name:'Chọn lại món'}));
 expect(localStorage.getItem('fnb.guest.intent.v1.TEST-A')).toBeNull();expect(create).not.toHaveBeenCalled();
});
it('does not permit choose again when explicit abandon outcome is unknown',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));read.mockResolvedValue({kind:'unknown'});abandon.mockResolvedValue({kind:'unknown'});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Đóng yêu cầu cũ để chọn lại món'}));
 await waitFor(()=>expect(abandon).toHaveBeenCalledTimes(1));
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toEqual(intent);
 expect(screen.queryByRole('button',{name:'Chọn lại món'})).toBeNull();expect(create).not.toHaveBeenCalled();
});
it('resumes a saved abandonment fence without treating it as an order',()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify({...intent,resolved:true,receipt:{error:'REQUEST_ABANDONED',request_id:intent.requestId,idempotent:true}}));
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByRole('button',{name:'Chọn lại món'})).toBeInTheDocument();
 expect(screen.queryByText('Đã gửi đơn!')).toBeNull();expect(read).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
it('keeps the committed order when it wins against explicit abandon',async()=>{
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify(intent));read.mockResolvedValue({kind:'unknown'});
 const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,bank:null,expires_at:'2026-10-21T12:00:00Z'};
 abandon.mockResolvedValue({kind:'found',receipt});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Đóng yêu cầu cũ để chọn lại món'}));
 await screen.findByText('Đã gửi đơn!');expect(screen.queryByRole('button',{name:'Chọn lại món'})).toBeNull();
 expect(JSON.parse(localStorage.getItem('fnb.guest.intent.v1.TEST-A')!)).toMatchObject({resolved:true,receipt});expect(create).not.toHaveBeenCalled();
});
it('preserves pending bank receipt instead of offering a local-only fake cancellation',()=>{
 const bank={bank_name:'LOCAL TEST NOT A BANK',bank_bin:null,account_number:'TEST-NON-BANK',account_holder:'NO REAL ACCOUNT',qr_code_url:null};
 const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'bank_transfer',reference_code:'TEST350',bank,expires_at:'2026-10-21T12:30:00Z'};
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify({...intent,paymentMethod:'bank_transfer',resolved:true,receipt}));
 status.mockReturnValue({data:{order:{order_status:'pending'},bank,bank_source:'snapshot'}});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.queryByRole('button',{name:'Huỷ / gọi lại'})).toBeNull();
 expect(screen.getByText('Đơn chuyển khoản đang chờ')).toBeInTheDocument();
 expect(screen.getByText('Muốn hủy hoặc đổi cách thanh toán, vui lòng liên hệ nhân viên. Đơn vẫn đang chờ trên server.')).toBeInTheDocument();
 expect(localStorage.getItem('fnb.guest.intent.v1.TEST-A')).not.toBeNull();expect(create).not.toHaveBeenCalled();expect(abandon).not.toHaveBeenCalled();
});
it('shows a shipped order as delivered rather than still being prepared',()=>{
 savedOrder();status.mockReturnValue({data:{order:{order_status:'shipped'}}});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByText('Đã giao món!')).toBeInTheDocument();expect(screen.queryByText('Món của bạn đang được chuẩn bị. Cảm ơn bạn!')).toBeNull();
});
it.each(['unverified',undefined])('does not fall back to cached bank instructions when source is %s',bank_source=>{
 const bank={bank_name:'LOCAL TEST NOT A BANK',bank_bin:null,account_number:'TEST-CACHED-ACCOUNT',account_holder:'NO REAL ACCOUNT',qr_code_url:null};
 const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'bank_transfer',reference_code:'TEST352',bank,expires_at:'2026-10-21T12:30:00Z'};
 localStorage.setItem('fnb.guest.intent.v1.TEST-A',JSON.stringify({...intent,paymentMethod:'bank_transfer',resolved:true,receipt}));
 status.mockReturnValue({data:{order:{order_status:'pending'},bank:null,bank_source},refetch:vi.fn()});
 render(<MemoryRouter initialEntries={['/fnb/order?t=TEST-A']}><FnbTableOrder/></MemoryRouter>);
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được thông tin ngân hàng');
 expect(screen.queryByText('TEST-CACHED-ACCOUNT')).toBeNull();expect(screen.queryByRole('button',{name:'Gọi lại'})).toBeNull();
 expect(localStorage.getItem('fnb.guest.intent.v1.TEST-A')).not.toBeNull();expect(create).not.toHaveBeenCalled();
});
