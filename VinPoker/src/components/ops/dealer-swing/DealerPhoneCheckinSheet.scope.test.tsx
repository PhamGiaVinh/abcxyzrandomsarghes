// @vitest-environment jsdom
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DealerPhoneCheckinSheet} from './DealerPhoneCheckinSheet';
import type {PublishedScheduleAssignment} from '@/hooks/usePublishedDealerSchedule';
const h=vi.hoisted(()=>({lookup:vi.fn(),rpc:vi.fn(),completed:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,from:()=>{
 const b={select:()=>b,eq:()=>b,is:()=>b,order:()=>b,in:()=>b,abortSignal:()=>b,
  maybeSingle:()=>h.lookup(),then:(yes:unknown,no:unknown)=>Promise.resolve({data:[],error:null}).then(yes as never,no as never)};
 return b;
}}}));
vi.mock('html5-qrcode',()=>({Html5Qrcode:class{start=vi.fn(async()=>{});stop=vi.fn(async()=>{});clear=vi.fn();}}));
beforeEach(()=>sessionStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();});
function Harness(){const[open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>Mở lại TEST</button>
 <DealerPhoneCheckinSheet actorId="55555555-5555-4555-8555-555555555555" open={open} activeClubId="22222222-2222-4222-8222-222222222222" scheduleAssignments={[]}
  onOpenChange={setOpen} onCompleted={h.completed} onRolloutDisabled={vi.fn()}/></>;}
it('labels the empty manual picker as no unchecked dealers, not no active dealers',async()=>{
 render(<Harness/>);await act(async()=>{});
 fireEvent.click(screen.getByRole('tab',{name:'Danh sách'}));
 expect(screen.getByText('Không còn dealer chưa check-in để chọn.')).toBeTruthy();
 expect(screen.queryByText('Không còn dealer active để chọn.')).toBeNull();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('does not add a QR response from a sheet that was closed and reopened',async()=>{
 let resolve!: (value:unknown)=>void;h.lookup.mockReturnValue(new Promise(r=>{resolve=r;}));
 render(<Harness/>);
 fireEvent.click(screen.getByRole('tab',{name:'Dán mã'}));
 fireEvent.change(screen.getByLabelText('Mã QR VinPoker'),{target:{value:'vinpoker://user/11111111-1111-4111-8111-111111111111'}});
 fireEvent.click(screen.getByRole('button',{name:'Thêm dealer từ mã đã dán'}));
 expect(h.lookup).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Close'}));
 fireEvent.click(screen.getByRole('button',{name:'Mở lại TEST'}));
 await act(async()=>{resolve({error:null,data:{id:'33333333-3333-4333-8333-333333333333',full_name:'Dealer A old response',tier:'A',status:'active',deleted_at:null}});});
 expect(screen.queryByText('Dealer A old response',{exact:true})).toBeNull();
 expect(screen.getByRole('button',{name:'Check-in 0 dealer'})).toBeDisabled();
 expect(h.rpc).not.toHaveBeenCalled();
});
it('retains the exact batch across unmount after an unknown mutation',async()=>{
 h.lookup.mockResolvedValue({error:null,data:{id:'33333333-3333-4333-8333-333333333333',full_name:'Pending dealer',tier:'A',status:'active',deleted_at:null}});
 h.rpc.mockRejectedValueOnce(Error('RESPONSE_LOST'));
 const view=render(<Harness/>);
 fireEvent.click(screen.getByRole('tab',{name:'Dán mã'}));
 fireEvent.change(screen.getByLabelText('Mã QR VinPoker'),{target:{value:'vinpoker://user/11111111-1111-4111-8111-111111111111'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thêm dealer từ mã đã dán'}));});
 fireEvent.change(screen.getByPlaceholderText('Lý do riêng cho Pending dealer'),{target:{value:'TEST outside schedule'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 const original=structuredClone(h.rpc.mock.calls[0]);
 view.unmount();render(<Harness/>);
 expect(screen.queryByRole('button',{name:'Check-in 0 dealer'})).toBeNull();
 h.rpc.mockImplementation(async(_name,args)=>({error:null,data:{outcome:'completed',request_id:args.p_request_id,club_id:args.p_expected_club_id,
  results:args.p_entries.map((entry:{entry_id:string})=>({entry_id:entry.entry_id,dealer_id:'33333333-3333-4333-8333-333333333333',code:'checked_in_available'}))}}));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Gửi lại nguyên yêu cầu check-in'}));});
 expect(h.rpc.mock.calls[1]).toEqual(original);
 expect(screen.getByText('Đã xử lý toàn bộ dealer')).toBeTruthy();
 expect(h.completed).toHaveBeenCalledTimes(1);
});
async function preparePendingDealer(){
 h.lookup.mockResolvedValue({error:null,data:{id:'33333333-3333-4333-8333-333333333333',full_name:'Pending dealer',tier:'A',status:'active',deleted_at:null}});
 render(<Harness/>);fireEvent.click(screen.getByRole('tab',{name:'Dán mã'}));
 fireEvent.change(screen.getByLabelText('Mã QR VinPoker'),{target:{value:'vinpoker://user/11111111-1111-4111-8111-111111111111'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thêm dealer từ mã đã dán'}));});
 fireEvent.change(screen.getByPlaceholderText('Lý do riêng cho Pending dealer'),{target:{value:'TEST'} });
}
const shiftA:PublishedScheduleAssignment={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dealerId:'33333333-3333-4333-8333-333333333333',
 dealerName:'Scheduled dealer',scheduledStartAt:'2026-10-21T01:00:00Z',scheduledEndAt:'2026-10-21T09:00:00Z',arrivalAt:null,payrollStartAt:null,state:'published',late:false};
const shiftB:PublishedScheduleAssignment={...shiftA,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',scheduledStartAt:'2026-10-21T09:00:00Z',scheduledEndAt:'2026-10-21T15:00:00Z'};
const scheduledProps={actorId:'55555555-5555-4555-8555-555555555555',open:true,activeClubId:'22222222-2222-4222-8222-222222222222',
 onOpenChange:vi.fn(),onCompleted:h.completed,onRolloutDisabled:vi.fn()};
async function addScheduledDealer(){
 h.lookup.mockResolvedValue({error:null,data:{id:shiftA.dealerId,full_name:'Scheduled dealer',tier:'A',status:'active',deleted_at:null}});
 fireEvent.click(screen.getByRole('tab',{name:'Dán mã'}));
 fireEvent.change(screen.getByLabelText('Mã QR VinPoker'),{target:{value:'vinpoker://user/11111111-1111-4111-8111-111111111111'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thêm dealer từ mã đã dán'}));});
}
it('fails closed on inconsistent multiple published shifts instead of inventing a valid selection',async()=>{
 render(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftA,shiftB]}/>);await addScheduledDealer();
 expect(screen.getByRole('button',{name:'Check-in 1 dealer'})).toBeDisabled();
 expect(h.rpc).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('Lịch không nhất quán');
 expect(screen.queryByRole('combobox')).toBeNull();
});
it('invalidates a draft assignment removed by schedule refresh instead of silently substituting another',async()=>{
 const view=render(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftA]}/>);await addScheduledDealer();
 expect(screen.getByRole('button',{name:'Check-in 1 dealer'})).toBeEnabled();
 view.rerender(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftB]}/>);
 expect(screen.getByRole('button',{name:'Check-in 1 dealer'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận ca hiện hành cho Scheduled dealer'}));
 expect(screen.getByRole('button',{name:'Check-in 1 dealer'})).toBeEnabled();
 h.rpc.mockResolvedValue({data:null,error:null});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 expect(h.rpc.mock.calls[0][1].p_entries[0]).toMatchObject({mode:'scheduled',shift_assignment_id:shiftB.id,reason:null});
});
it('requires explicit outside-schedule intent and reason after the selected shift closes',async()=>{
 const view=render(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftA]}/>);await addScheduledDealer();
 view.rerender(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[{...shiftA,state:'closed'}]}/>);
 expect(screen.getByRole('button',{name:'Check-in 1 dealer'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Ca cũ không còn · chuyển sang ngoài lịch'}));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 expect(h.rpc).not.toHaveBeenCalled();
 fireEvent.change(screen.getByPlaceholderText('Lý do riêng cho Scheduled dealer'),{target:{value:'TEST explicit unscheduled'}});
 h.rpc.mockResolvedValue({data:null,error:null});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 expect(h.rpc.mock.calls[0][1].p_entries[0]).toMatchObject({mode:'unscheduled',shift_assignment_id:null,reason:'TEST explicit unscheduled'});
});
it('keeps the selected assignment in the durable unknown request even after schedule refresh and remount',async()=>{
 const view=render(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftA]}/>);await addScheduledDealer();
 h.rpc.mockRejectedValueOnce(Error('RESPONSE_LOST'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 const original=structuredClone(h.rpc.mock.calls[0]);view.unmount();
 render(<DealerPhoneCheckinSheet {...scheduledProps} scheduleAssignments={[shiftB]}/>);
 h.rpc.mockResolvedValue({data:null,error:null});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Gửi lại nguyên yêu cầu check-in'}));});
 expect(h.rpc.mock.calls[1]).toEqual(original);
 expect(h.rpc.mock.calls[1][1].p_entries[0].shift_assignment_id).toBe(shiftA.id);
 expect(h.completed).not.toHaveBeenCalled();
});
it('keeps malformed completed response unverified rather than firing completion',async()=>{
 await preparePendingDealer();h.rpc.mockResolvedValue({error:null,data:{outcome:'completed',results:[]}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 expect(h.completed).not.toHaveBeenCalled();
 expect(screen.queryByText('Đã xử lý toàn bộ dealer')).toBeNull();
 expect(screen.getByRole('button',{name:'Gửi lại nguyên yêu cầu check-in'})).toBeTruthy();
});
it('does not dispatch when durable storage fails',async()=>{
 await preparePendingDealer();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('DENIED');});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check-in 1 dealer'}));});
 expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Chưa gửi thao tác mới');
});
it('lets the reopened sheet resolve its own QR and ignores the old rejection',async()=>{
 let reject!: (error:Error)=>void;
 h.lookup.mockReturnValueOnce(new Promise((_,r)=>{reject=r;})).mockResolvedValueOnce({error:null,data:{
  id:'44444444-4444-4444-8444-444444444444',full_name:'Fresh dealer',tier:'B',status:'active',deleted_at:null}});
 render(<Harness/>);
 const paste=()=>{
  fireEvent.click(screen.getByRole('tab',{name:'Dán mã'}));
  fireEvent.change(screen.getByLabelText('Mã QR VinPoker'),{target:{value:'vinpoker://user/11111111-1111-4111-8111-111111111111'}});
  fireEvent.click(screen.getByRole('button',{name:'Thêm dealer từ mã đã dán'}));
 };
 paste();fireEvent.click(screen.getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Mở lại TEST'}));
 paste();await act(async()=>{});
 expect(screen.getByText('Fresh dealer',{exact:true})).toBeTruthy();
 await act(async()=>{reject(Error('OLD_LOOKUP_FAILURE'));});
 expect(screen.queryByText('OLD_LOOKUP_FAILURE')).toBeNull();
 expect(screen.getByText('Đã thêm Fresh dealer.')).toBeTruthy();
 expect(h.rpc).not.toHaveBeenCalled();
});
