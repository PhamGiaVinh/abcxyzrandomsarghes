import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
const h=vi.hoisted(()=>({invoke:vi.fn(),success:vi.fn(),error:vi.fn(),transfer:vi.fn(),session:{access_token:'LOCAL_SESSION_1'}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:h.invoke}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null,session:h.session})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key}),Trans:()=>null}));
vi.mock('@/components/TransferInstructions',()=>({TransferInstructions:(props:{escrowAccount?:unknown;committedAt?:string})=>{h.transfer(props.escrowAccount,props.committedAt);return <div>TRANSFER_VERIFIED</div>;}}));
import {DealDetailDialog} from './Marketplace';
const actor='e5030000-0000-4000-8000-000000000001';
const deal={id:'e5030000-0000-4000-8000-000000000002',player_id:'e5030000-0000-4000-8000-000000000003',
 percentage_sold:10,filled_percent:0,min_purchase_percent:5,buy_in_amount_vnd:1000000,markup:1,status:'listing',
 custom_event_name:'TEST503',created_at:new Date().toISOString(),early_closed:false} as ComponentProps<typeof DealDetailDialog>['deal'];
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();h.session={access_token:'LOCAL_SESSION_1'};
 vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>callback({name:_name}))}});
});
it('does not dispatch when another tab owns the actor/deal purchase lock',async()=>{
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,callback:(lock:null)=>Promise<unknown>)=>callback(null)}});
 h.invoke.mockResolvedValue({data:null,error:{message:'LOCAL response lost'}});
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();
});
it('does not settle an old same-actor session response after session renewal',async()=>{
 let release!:(value:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const props={deal,onClose:()=>{},onPurchased:()=>{},currentUser:actor,onAuthRequired:()=>{}};
 const view=render(<DealDetailDialog {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 const body=h.invoke.mock.calls[0][1].body;
 h.session={access_token:'LOCAL_SESSION_2'};view.rerender(<DealDetailDialog {...props}/>);
 await act(async()=>release({data:{success:true,purchase_id:'e5030000-0000-4000-8000-000000000004',
  request_id:body.request_id,deal_id:body.deal_id,reference_code:'LOCAL_TEST_ONLY',amount_vnd:100000,committed_at:'2026-10-23T00:00:00+00:00',
  deal_status:'committed',filled_percent:10,bank_name:'LOCAL',account_number:'LOCAL_ONLY',account_holder:'TEST'},error:null}));
 expect(h.success).not.toHaveBeenCalled();expect(screen.queryByText('TRANSFER_VERIFIED')).not.toBeInTheDocument();
 expect(localStorage.getItem(`vinpoker:staking-purchase:v1:${actor}:${deal?.id}`)).not.toBeNull();
});
it('accepts a canonical reservation receipt',async()=>{
 h.invoke.mockImplementation((_name,options)=>Promise.resolve({data:{success:true,purchase_id:'e5030000-0000-4000-8000-000000000004',
  request_id:options.body.request_id,deal_id:options.body.deal_id,
  committed_at:'2026-10-23T00:00:00+00:00',
  reference_code:'LOCAL_TEST_ONLY',amount_vnd:100000,deal_status:'committed',filled_percent:10,
  bank_name:'LOCAL',account_number:'LOCAL_ONLY',account_holder:'TEST'},error:null}));
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await screen.findByText('TRANSFER_VERIFIED');expect(h.success).toHaveBeenCalledTimes(1);expect(h.error).not.toHaveBeenCalled();
 expect(h.transfer).toHaveBeenLastCalledWith({bank_name:'LOCAL',account_number:'LOCAL_ONLY',account_holder:'TEST',qr_code_url:null,notes:null},'2026-10-23T00:00:00+00:00');
});
it.each(['request_id','deal_id'])('does not settle a canonical receipt belonging to another %s',async(field)=>{
 h.invoke.mockImplementation((_name,options)=>Promise.resolve({data:{success:true,purchase_id:'e5030000-0000-4000-8000-000000000004',
  request_id:options.body.request_id,deal_id:options.body.deal_id,[field]:'e5030000-0000-4000-8000-000000000099',
  committed_at:'2026-10-23T00:00:00+00:00',
  reference_code:'LOCAL_TEST_ONLY',amount_vnd:100000,deal_status:'committed',filled_percent:10,
  bank_name:'LOCAL',account_number:'LOCAL_ONLY',account_holder:'TEST'},error:null}));
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
 expect(localStorage.getItem(`vinpoker:staking-purchase:v1:${actor}:${deal?.id}`)).not.toBeNull();
});
it('dispatches once for same-tick double confirmation',async()=>{
 const releases:Array<(value:unknown)=>void>=[];
 h.invoke.mockImplementation(()=>new Promise(resolve=>{releases.push(resolve);}));
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 const button=screen.getByRole('button',{name:'marketplace.confirmReserve'});
 act(()=>{fireEvent.click(button);fireEvent.click(button);});
 const count=h.invoke.mock.calls.length;
 await act(async()=>{for(const release of releases)release({data:null,error:{message:'LOCAL response lost'}});});
 expect(count).toBe(1);
});
it('ignores a completed purchase response after account scope changes',async()=>{
 let release!:(value:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const props={deal,onClose:()=>{},onPurchased:()=>{},onAuthRequired:()=>{}};
 const view=render(<DealDetailDialog {...props} currentUser={actor}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 view.rerender(<DealDetailDialog {...props} currentUser="e5030000-0000-4000-8000-000000000005"/>);
 await act(async()=>release({data:{success:true,purchase_id:'e5030000-0000-4000-8000-000000000004',
  reference_code:'LOCAL_TEST_ONLY',amount_vnd:100000,deal_status:'committed',filled_percent:10,
  bank_name:'LOCAL',account_number:'LOCAL_ONLY',account_holder:'TEST'},error:null}));
 expect(h.success).not.toHaveBeenCalled();expect(screen.queryByText('TRANSFER_VERIFIED')).not.toBeInTheDocument();
});
it('reuses the exact request ID after a lost response and remount',async()=>{
 h.invoke.mockResolvedValue({data:null,error:{message:'LOCAL response lost'}});
 const props={deal,onClose:()=>{},onPurchased:()=>{},currentUser:actor,onAuthRequired:()=>{}};
 const view=render(<DealDetailDialog {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());
 const first=h.invoke.mock.calls[0][1].body;
 view.unmount();render(<DealDetailDialog {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(2));
 const second=h.invoke.mock.calls[1][1].body;
 expect(first.request_id).toMatch(/^[0-9a-f-]{36}$/i);expect(second).toEqual(first);
});
it('does not send a mutation if durable intent storage fails',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL storage unavailable');});
 try{
  h.invoke.mockResolvedValue({data:null,error:{message:'LOCAL response lost'}});
  render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
  fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
  await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();
 }finally{storage.mockRestore();}
});
it.each(['broken-json',JSON.stringify({actor_id:'e5030000-0000-4000-8000-000000000099',deal_id:deal?.id,
 request_id:'e5030000-0000-4000-8000-000000000006',percent:5})])('preserves unresolved evidence and blocks corrupt/scope-mismatched intent %s',async(raw)=>{
 const key=`vinpoker:staking-purchase:v1:${actor}:${deal?.id}`;localStorage.setItem(key,raw);
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(raw);
});
it('offers explicit pending-percent recovery without automatically sending',async()=>{
 const key=`vinpoker:staking-purchase:v1:${actor}:${deal?.id}`;
 localStorage.setItem(key,JSON.stringify({actor_id:actor,deal_id:deal?.id,
  request_id:'e5030000-0000-4000-8000-000000000006',percent:5}));
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Khôi phục lựa chọn đang chờ: 5%'}));
 expect(screen.getByRole('spinbutton')).toHaveValue(5);expect(screen.getByRole('spinbutton')).toBeDisabled();expect(h.invoke).not.toHaveBeenCalled();
});
it('can resolve the saved intent after its own commit filled the deal',async()=>{
 const request='e5030000-0000-4000-8000-000000000006';
 localStorage.setItem(`vinpoker:staking-purchase:v1:${actor}:${deal?.id}`,JSON.stringify({actor_id:actor,deal_id:deal?.id,request_id:request,percent:10}));
 h.invoke.mockResolvedValue({data:null,error:{message:'LOCAL recovery retry'}});
 render(<DealDetailDialog deal={{...deal!,filled_percent:10,status:'committed'}} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Khôi phục lựa chọn đang chờ: 10%'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
 expect(h.invoke.mock.calls[0][1].body).toEqual({deal_id:deal?.id,request_id:request,percent:10});
});
it('keeps the bank-profile error visible in the dialog, not only in a toast',async()=>{
 h.invoke.mockResolvedValue({data:null,error:{message:'LOCAL rejected',context:{json:async()=>({code:'MISSING_BANK_ACCOUNT',error:'Cần bổ sung tài khoản ngân hàng TEST'})}}});
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Cần bổ sung tài khoản ngân hàng TEST');
 expect(screen.getByRole('alert')).toHaveFocus();
 expect(h.success).not.toHaveBeenCalled();
});
it.each([null,{}, {success:false}, {success:true,purchase_id:'wrong',amount_vnd:-1}])('does not accept malformed reservation %j',async(data)=>{
 h.invoke.mockResolvedValue({data,error:null});
 render(<DealDetailDialog deal={deal} onClose={()=>{}} onPurchased={()=>{}} currentUser={actor} onAuthRequired={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'marketplace.buyAction'}));
 fireEvent.click(screen.getByRole('button',{name:'marketplace.confirmReserve'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
 expect(screen.queryByText('TRANSFER_VERIFIED')).not.toBeInTheDocument();
});
