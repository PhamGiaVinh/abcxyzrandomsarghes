import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const h=vi.hoisted(()=>({rpc:vi.fn(),receipt:vi.fn(),history:vi.fn(),success:vi.fn(),
  menuError:false,session:{access_token:'LOCAL_TEST'},actor:'10000000-0000-4000-8000-000000000001'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session,loading:false})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn().mockResolvedValue(undefined)})}));
vi.mock('@/hooks/useFnbMenu',()=>({useFnbMenu:()=>({data:{ingredients:[{id:'40000000-0000-4000-8000-000000000001',name:'Ingredient TEST',stock_unit:'unit',purchase_unit:null,units_per_purchase:1,is_active:true}]},isLoading:false,isError:h.menuError,refetch:vi.fn()})}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:h.success}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  rpc:(...args:unknown[])=>{const p=h.rpc(...args);return Object.assign(p,{abortSignal:()=>p});},
  from:()=>{let request:string|undefined;const q={select:()=>q,eq:(key:string,value:string)=>{if(key==='client_request_id')request=value;return q;},order:()=>q,limit:()=>q,
    abortSignal:()=>q,then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>(request?h.receipt(request):h.history()).then(resolve,reject)};return q;},
}}));
vi.mock('@/components/ui/select',()=>({Select:({children,value,onValueChange,disabled}:{children:ReactNode;value:string;onValueChange:(v:string)=>void;disabled?:boolean})=><select aria-label="TEST ingredient" value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}><option value=""/>{children}</select>,SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:{children:ReactNode})=><>{children}</>,SelectItem:({children,value}:{children:ReactNode;value:string})=><option value={value}>{children}</option>}));
import {StockInForm} from './StockInForm';
import {persistFnbStockInIntent,readFnbStockInJournal} from '@/lib/fnbStockInIntent';
const actor='10000000-0000-4000-8000-000000000001',club='20000000-0000-4000-8000-000000000001';
const backend='http://127.0.0.1:54329',key='30000000-0000-4000-8000-000000000001';
const payload={ingredient_id:'40000000-0000-4000-8000-000000000001',qty_purchase:0.5,unit_cost_purchase:1000};
const found=(requestId:string)=>[{id:'50000000-0000-4000-8000-000000000001',actor,club_id:club,client_request_id:requestId,
  ingredient_id:payload.ingredient_id,reason:'stock_in',ref_type:'manual',delta:0.5,unit_cost:1000,balance_after:14.5,
  details:{stock_in_intent_v1:{version:1,club_id:club,...payload}}}];
beforeEach(()=>{
  localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL',backend);h.menuError=false;h.actor=actor;h.session={access_token:'LOCAL_TEST'};
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:string,work:()=>unknown)=>work())}});
  h.rpc.mockReset().mockResolvedValue({data:null,error:{message:'503'}});h.receipt.mockReset().mockResolvedValue({data:null,error:{message:'503'}});
  h.history.mockReset().mockResolvedValue({data:[],error:null});h.success.mockReset();
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.restoreAllMocks();});
it('locks an unknown stock intent over remount and recovers it by an explicit receipt read without another write',async()=>{
  const v=render(<StockInForm clubId={club}/>);await screen.findByText('Chưa có chuyển động kho.');
  fireEvent.change(screen.getByRole('combobox'),{target:{value:payload.ingredient_id}});
  fireEvent.change(screen.getByLabelText(/Số lượng mua/),{target:{value:'0.5'}});
  fireEvent.change(screen.getByLabelText(/Giá 1 đơn vị mua/),{target:{value:'1000'}});
  fireEvent.click(screen.getByRole('button',{name:'Nhập kho'}));
  await screen.findByRole('button',{name:'Kiểm tra lệnh nhập kho'});
  const requestId=h.rpc.mock.calls[0][1].p_client_request_id;
  expect(screen.getByRole('button',{name:'Nhập kho'})).toBeDisabled();
  v.unmount();h.rpc.mockClear();h.receipt.mockClear();
  render(<StockInForm clubId={club}/>);await screen.findByRole('button',{name:'Kiểm tra lệnh nhập kho'});
  expect(h.rpc).not.toHaveBeenCalled();expect(h.receipt).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/Số lượng mua/)).toHaveValue(0.5);expect(screen.getByLabelText(/Giá 1 đơn vị mua/)).toHaveValue(1000);
  h.receipt.mockResolvedValue({data:found(requestId),error:null});fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lệnh nhập kho'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Kiểm tra lệnh nhập kho'})).toBeNull());
  expect(h.rpc).not.toHaveBeenCalled();expect(h.success).toHaveBeenCalledOnce();
  expect(readFnbStockInJournal(localStorage,actor,club,backend)?.state).toBe('settled');
  expect(screen.getByLabelText(/Số lượng mua/)).toHaveValue(null);
});
it('keeps a resumed legacy receipt unresolved and prevents creating a different stock request',async()=>{
  persistFnbStockInIntent(localStorage,{actorId:actor,clubId:club,backend,requestId:key,payload});
  h.receipt.mockResolvedValue({data:[{...found(key)[0],details:{}}],error:null});
  render(<StockInForm clubId={club}/>);await screen.findByText('Chưa có chuyển động kho.');
  expect(screen.getByRole('button',{name:'Nhập kho'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lệnh nhập kho'}));await act(async()=>{});
  expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được lệnh nhập kho');
  expect(screen.getByRole('alert')).toHaveTextContent('thiếu nội dung yêu cầu gốc');
  expect(screen.getByRole('button',{name:'Gửi lại cùng mã nhập kho'})).toBeDisabled();
  expect(screen.getByLabelText(/Số lượng mua/)).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
  expect(readFnbStockInJournal(localStorage,actor,club,backend)?.state).toBe('pending');
});

it('still offers read-only receipt recovery while catalogue is unavailable and holds writer retry',async()=>{
 persistFnbStockInIntent(localStorage,{actorId:actor,clubId:club,backend,requestId:key,payload});h.menuError=true;
 render(<StockInForm clubId={club}/>);
 expect(screen.getByRole('button',{name:'Kiểm tra lệnh nhập kho'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Gửi lại cùng mã nhập kho'})).toBeDisabled();
 h.receipt.mockResolvedValue({data:found(key),error:null});fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lệnh nhập kho'}));
 await waitFor(()=>expect(readFnbStockInJournal(localStorage,actor,club,backend)?.state).toBe('settled'));
 expect(h.rpc).not.toHaveBeenCalled();expect(h.success).toHaveBeenCalledOnce();
});
it('retires unsent UI drafts on credential incarnation change without dispatching an intent',async()=>{
 const v=render(<StockInForm clubId={club}/>);await screen.findByText('Chưa có chuyển động kho.');
 fireEvent.change(screen.getByRole('combobox'),{target:{value:payload.ingredient_id}});
 fireEvent.change(screen.getByLabelText(/Số lượng mua/),{target:{value:'0.5'}});
 h.session.access_token='LOCAL_TEST_RENEWED';await act(async()=>{v.rerender(<StockInForm clubId={club}/>);});
 await screen.findByText('Chưa có chuyển động kho.');
 expect(screen.getByLabelText(/Số lượng mua/)).toHaveValue(null);expect(h.rpc).not.toHaveBeenCalled();
 expect(h.receipt).not.toHaveBeenCalled();expect(readFnbStockInJournal(localStorage,actor,club,backend)).toBeNull();
});
