import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const actor='e5680000-0000-4000-8000-000000000001',deal='e5680000-0000-4000-8000-000000000002';
const h=vi.hoisted(()=>({count:vi.fn(),remove:vi.fn(),invoke:vi.fn(),read:vi.fn(),success:vi.fn(),error:vi.fn(),session:{access_token:'LOCAL568'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor},session:h.session})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:h.invoke},from:(table:string)=>{
 let deleting=false,reviewFilter='';const q={select:()=>q,eq:(key:string,value:string)=>{if(key==='admin_review_status')reviewFilter=value;return q;},in:()=>q,order:()=>q,limit:()=>q,abortSignal:()=>q,delete:()=>{deleting=true;return q;},
  then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve().then(()=>deleting?h.remove():table==='staking_purchases'?h.count():h.read(table,
   table==='staking_deals'&&reviewFilter==='rejected'?[{id:deal,player_id:actor,buy_in_amount_vnd:1000000,percentage_sold:10,markup:1,asking_price_vnd:100000,custom_event_name:'LOCAL568',custom_event_date:'2026-10-24',created_at:'2026-10-24',admin_review_status:'rejected',status:'listing'}]:[])).then(resolve,reject)};return q;
 },channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn()}}));
import {ReviewListingsTab} from './AdminStaking';
const canonical={success:true,deal_id:deal,status:'cancelled',archived:true};
const intent={actor_id:actor,deal_id:deal,expected_review:'rejected'};
const key=`vinpoker:staking-listing-archive:v1:${actor}:${deal}`;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();h.session={access_token:'LOCAL568'};Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});h.read.mockImplementation((_table,rows)=>({data:rows,error:null}));h.invoke.mockResolvedValue({data:canonical,error:null});});
async function rejected(){fireEvent.keyDown(screen.getByRole('combobox'),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:'Đã từ chối'}));}
async function open(){await rejected();fireEvent.click(await screen.findByRole('button',{name:'Lưu trữ phiếu đăng ký'}));return screen.getByRole('button',{name:'Lưu trữ'});}
it('offers archive with retained history rather than irreversible deletion',async()=>{
 render(<ReviewListingsTab/>);await open();expect(screen.getByRole('alertdialog')).toHaveTextContent('Lịch sử và audit được giữ nguyên');expect(screen.queryByRole('button',{name:'Xóa'})).not.toBeInTheDocument();
});
it('persists intent before one canonical archive request and never performs client DELETE/count',async()=>{
 h.invoke.mockImplementation(()=>{expect(JSON.parse(localStorage.getItem(key)!)).toEqual(intent);return {data:canonical,error:null};});render(<ReviewListingsTab/>);fireEvent.click(await open());
 await waitFor(()=>expect(h.success).toHaveBeenCalledOnce());expect(h.invoke).toHaveBeenCalledExactlyOnceWith('admin-archive-staking-listing',{body:{deal_id:deal,expected_review:'rejected'}});expect(localStorage.getItem(key)).toBeNull();expect(h.count).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();
});
it.each([null,{}, {...canonical,deal_id:actor},{...canonical,status:'listing'},{...canonical,archived:false},{...canonical,error:'denied'}])('retains intent and never reports archive success from %j',async data=>{
 h.invoke.mockResolvedValue({data,error:null});render(<ReviewListingsTab/>);fireEvent.click(await open());await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();expect(screen.getByRole('button',{name:'Lưu trữ phiếu đăng ký'})).toBeDisabled();
});
it.each(['rejected_promise','server_denied'])('keeps unknown/denied outcome recoverable without automatic retry: %s',async fault=>{
 if(fault==='rejected_promise')h.invoke.mockRejectedValue(new Error('LOCAL503'));else h.invoke.mockResolvedValue({data:{error:'has_dependencies'},error:null});
 render(<ReviewListingsTab/>);fireEvent.click(await open());expect(await screen.findByRole('status')).toHaveTextContent('Chưa xác minh');expect(h.invoke).toHaveBeenCalledOnce();expect(h.success).not.toHaveBeenCalled();expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:`Tra kết quả lưu trữ ${deal}`})).toBeEnabled();
});
it('keeps read-only recovery available after reload even with no listing rows',async()=>{
 localStorage.setItem(key,JSON.stringify(intent));render(<ReviewListingsTab/>);expect(await screen.findByRole('button',{name:`Tra kết quả lưu trữ ${deal}`})).toBeEnabled();expect(h.invoke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:`Tra kết quả lưu trữ ${deal}`}));expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu trữ');expect(h.invoke).toHaveBeenCalledExactlyOnceWith('admin-staking-listing-archive-status',expect.objectContaining({body:{deal_id:deal,expected_review:'rejected'}}));expect(localStorage.getItem(key)).toBeNull();
});
it.each(['not_recorded','needs_attention'])('treats read %s as observation, not automatic archive',async state=>{
 localStorage.setItem(key,JSON.stringify(intent));h.invoke.mockResolvedValue({data:{success:false,deal_id:deal,state},error:null});render(<ReviewListingsTab/>);await rejected();
 fireEvent.click(await screen.findByRole('button',{name:`Tra kết quả lưu trữ ${deal}`}));expect(await screen.findByRole('status')).toHaveTextContent(state==='not_recorded'?'Chưa tìm thấy':'cần đối chiếu');expect(h.invoke).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).not.toBeNull();expect(screen.getByRole('button',{name:'Lưu trữ phiếu đăng ký'})).toHaveProperty('disabled',state!=='not_recorded');
});
it('fails closed before dispatch when storage cannot persist intent',async()=>{
 render(<ReviewListingsTab/>);const button=await open();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});
 try{fireEvent.click(button);await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('preserves corrupt journal and disables archive',async()=>{
 localStorage.setItem(key,'CORRUPT');render(<ReviewListingsTab/>);await rejected();expect(await screen.findByRole('alert')).toHaveTextContent('Giữ nguyên');expect(await screen.findByRole('button',{name:'Lưu trữ phiếu đăng ký'})).toBeDisabled();expect(h.invoke).not.toHaveBeenCalled();
});
it('serializes same-tick doubleclicks before the asynchronous writer returns',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));render(<ReviewListingsTab/>);const button=await open();act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(h.invoke).toHaveBeenCalledOnce();await act(async()=>resolve({data:canonical,error:null}));expect(h.success).toHaveBeenCalledOnce();
});
it('does not consume late success from a replaced authenticated session',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=render(<ReviewListingsTab/>);fireEvent.click(await open());h.session={access_token:'LOCAL_B'};view.rerender(<ReviewListingsTab/>);
 await act(async()=>resolve({data:canonical,error:null}));expect(h.success).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('does not turn a failed review list read into empty data',async()=>{
 h.read.mockResolvedValue({data:null,error:{message:'LOCAL503'}});render(<ReviewListingsTab/>);expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');expect(screen.queryByText('Không có deal nào ở trạng thái này.')).not.toBeInTheDocument();expect(h.invoke).not.toHaveBeenCalled();
});
it('keeps evidence after writer deadline and ignores later success without sending again',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));render(<ReviewListingsTab/>);const button=await open();
 vi.useFakeTimers();try{fireEvent.click(button);await act(async()=>{await vi.advanceTimersByTimeAsync(15001);});expect(screen.getByRole('status')).toHaveTextContent('Chưa xác minh');expect(h.success).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();
  await act(async()=>resolve({data:canonical,error:null}));expect(h.success).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).not.toBeNull();
 }finally{vi.useRealTimers();}
});
it('bounds a hung recovery read and keeps the pending intent',async()=>{
 localStorage.setItem(key,JSON.stringify(intent));h.invoke.mockImplementation(()=>new Promise(()=>{}));render(<ReviewListingsTab/>);const button=await screen.findByRole('button',{name:`Tra kết quả lưu trữ ${deal}`});
 vi.useFakeTimers();try{fireEvent.click(button);await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('status')).toHaveTextContent('Không tra được');expect(button).toBeEnabled();expect(h.invoke.mock.calls[0][1].signal.aborted).toBe(true);expect(localStorage.getItem(key)).not.toBeNull();expect(h.invoke).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}
});
it('keeps receipt recovery accessible while the listing read is hung',async()=>{
 localStorage.setItem(key,JSON.stringify(intent));h.read.mockImplementation(()=>new Promise(()=>{}));render(<ReviewListingsTab/>);
 expect(await screen.findByRole('button',{name:`Tra kết quả lưu trữ ${deal}`})).toBeEnabled();expect(h.invoke).not.toHaveBeenCalled();
});
it('ends a hung listing read with an unavailable state rather than endless loading',async()=>{
 h.read.mockImplementation(()=>new Promise(()=>{}));vi.useFakeTimers();try{render(<ReviewListingsTab/>);await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');expect(screen.queryByText('Không có deal nào ở trạng thái này.')).not.toBeInTheDocument();expect(h.invoke).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
});
