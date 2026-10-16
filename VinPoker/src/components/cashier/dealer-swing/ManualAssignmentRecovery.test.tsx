import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {ManualAssignmentRecovery} from "./ManualAssignmentRecovery";
import {initialAssignmentKey,type InitialAssignmentIntent} from "@/lib/dealerInitialAssignmentIntent";
const id=(n:number)=>`e1800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const intent:InitialAssignmentIntent={expected_actor_id:id(1),expected_club_id:id(2),table_id:id(3),table_session_id:id(4),force_dealer_id:id(5),idempotency_key:id(6)};
const key=initialAssignmentKey(intent);
const receipt=(i=intent,status="receipt_found")=>({data:{...i,mode:"receipt",status,assignment:status==="receipt_found"?{id:id(7),status:"success"}:null},error:null});
function props(){return {actorId:id(1),clubId:id(2),revision:0,blocked:false,invoke:vi.fn(),onSettled:vi.fn()};}
beforeEach(()=>{sessionStorage.clear();sessionStorage.setItem(key,intent.idempotency_key);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
it("restores an old journal without table cache or automatic writes",async()=>{
 const p=props();p.invoke.mockResolvedValue(receipt());render(<ManualAssignmentRecovery {...p}/>);
 expect(screen.getByText(/Phiên/)).toHaveTextContent(intent.table_session_id);expect(p.invoke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 await waitFor(()=>expect(p.onSettled).toHaveBeenCalledWith(intent,"committed"));expect(sessionStorage.getItem(key)).toBeNull();
 expect(p.invoke.mock.calls.map(c=>c[0])).toEqual([{mode:"receipt",assignment_intent:intent}]);
});
it("only an explicit retry after a second missing lookup sends the original intent",async()=>{
 const p=props();p.invoke.mockResolvedValueOnce(receipt(intent,"receipt_not_found")).mockResolvedValueOnce(receipt(intent,"receipt_not_found"))
  .mockResolvedValueOnce({data:{status:"success"},error:null}).mockResolvedValueOnce(receipt());
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 const retry=await screen.findByRole("button",{name:"Gửi lại đúng yêu cầu gán"});expect(p.invoke).toHaveBeenCalledTimes(1);
 fireEvent.click(retry);fireEvent.click(retry);await waitFor(()=>expect(p.onSettled).toHaveBeenCalledOnce());
 expect(p.invoke.mock.calls.map(c=>c[0])).toEqual([{mode:"receipt",assignment_intent:intent},{mode:"receipt",assignment_intent:intent},
  {...intent,mode:"assign",requested_by:intent.expected_actor_id},{mode:"receipt",assignment_intent:intent}]);
});
it("retains malformed receipts and read outages without exposing retry",async()=>{
 const p=props();p.invoke.mockResolvedValueOnce(receipt({...intent,table_session_id:id(44)})).mockResolvedValueOnce({data:null,error:{message:"read unavailable"}});
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 await screen.findByText(/Chưa có kết quả xác nhận/);expect(screen.queryByRole("button",{name:"Gửi lại đúng yêu cầu gán"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));await screen.findByText("read unavailable");
 expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);expect(p.onSettled).not.toHaveBeenCalled();
});
it("actor A-B-A cannot consume the original A acknowledgement",async()=>{
 const p=props();let finish!:(v:unknown)=>void;p.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 view.rerender(<ManualAssignmentRecovery {...p} actorId={id(99)}/>);view.rerender(<ManualAssignmentRecovery {...p}/>);
 await act(async()=>finish(receipt()));expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);expect(p.onSettled).not.toHaveBeenCalled();
});
it("a late receipt cannot remove a replaced journal",async()=>{
 const p=props();let finish!:(v:unknown)=>void;p.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));sessionStorage.setItem(key,id(88));
 await act(async()=>finish(receipt()));expect(sessionStorage.getItem(key)).toBe(id(88));expect(p.onSettled).not.toHaveBeenCalled();
 expect(screen.getByText(/Yêu cầu gán đã thay đổi/)).toBeInTheDocument();
});
it("bounds a hung receipt lookup and ignores late success",async()=>{
 vi.useFakeTimers();const p=props();let finish!:(v:unknown)=>void;p.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 await act(async()=>vi.advanceTimersByTimeAsync(10001));await act(async()=>finish(receipt()));
 expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);expect(p.onSettled).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"})).toBeEnabled();expect(p.invoke).toHaveBeenCalledTimes(1);
});
it("preserves corrupt same-scope journals without reading another account",()=>{
 const p=props();sessionStorage.setItem(key,"bad");sessionStorage.setItem(`vinpoker:manual-assign:${JSON.stringify([id(99),id(2),id(3),id(4),id(5)])}`,id(88));
 render(<ManualAssignmentRecovery {...p}/>);expect(screen.getByText(/Journal gán dealer không hợp lệ/)).toBeInTheDocument();expect(p.invoke).not.toHaveBeenCalled();
 expect(screen.queryByRole("button",{name:"Đối chiếu yêu cầu gán"})).toBeNull();expect(sessionStorage.getItem(key)).toBe("bad");
});
it("lists multiple older intents and clears only the reconciled one",async()=>{
 const p=props(),other={...intent,table_id:id(33),table_session_id:id(34),idempotency_key:id(36)};sessionStorage.setItem(initialAssignmentKey(other),other.idempotency_key);
 p.invoke.mockResolvedValue(receipt());render(<ManualAssignmentRecovery {...p}/>);expect(screen.getAllByRole("button",{name:"Đối chiếu yêu cầu gán"})).toHaveLength(2);
 fireEvent.click(screen.getAllByRole("button",{name:"Đối chiếu yêu cầu gán"})[0]);await waitFor(()=>expect(p.onSettled).toHaveBeenCalledOnce());
 expect(sessionStorage.getItem(initialAssignmentKey(other))).toBe(other.idempotency_key);expect(screen.getAllByRole("button",{name:"Đối chiếu yêu cầu gán"})).toHaveLength(1);
});
it("a lost retry response remains recoverable after remount without another writer",async()=>{
 const p=props();p.invoke.mockResolvedValueOnce(receipt(intent,"receipt_not_found")).mockResolvedValueOnce(receipt(intent,"receipt_not_found"))
  .mockResolvedValueOnce({data:null,error:{message:"lost response"}});
 const view=render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 fireEvent.click(await screen.findByRole("button",{name:"Gửi lại đúng yêu cầu gán"}));await screen.findByText("lost response");
 expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);view.unmount();p.invoke.mockReset().mockResolvedValue(receipt());
 render(<ManualAssignmentRecovery {...p}/>);expect(p.invoke).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 await waitFor(()=>expect(p.onSettled).toHaveBeenCalledOnce());expect(p.invoke.mock.calls.map(c=>c[0].mode)).toEqual(["receipt"]);
});
it("uses the latest settlement callback if the modal context changed during lookup",async()=>{
 const p=props(),latest=vi.fn();let finish!:(v:unknown)=>void;p.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));
 view.rerender(<ManualAssignmentRecovery {...p} onSettled={latest}/>);await act(async()=>finish(receipt()));
 expect(latest).toHaveBeenCalledWith(intent,"committed");expect(p.onSettled).not.toHaveBeenCalled();
});
it("clears a stale request only after explicit serialized obsolete proof",async()=>{
 const p=props();p.invoke.mockResolvedValue({data:{...intent,mode:"resolve",status:"intent_obsolete",assignment:null},error:null});
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));
 await waitFor(()=>expect(p.onSettled).toHaveBeenCalledWith(intent,"obsolete"));expect(sessionStorage.getItem(key)).toBeNull();
 expect(p.invoke.mock.calls.map(c=>c[0])).toEqual([{mode:"resolve",assignment_intent:intent}]);
});
it("receipt-only obsolete or malformed resolve metadata cannot clear a journal",async()=>{
 const p=props();p.invoke.mockResolvedValueOnce({data:{...intent,mode:"receipt",status:"intent_obsolete",assignment:null},error:null})
  .mockResolvedValueOnce({data:{...intent,table_session_id:id(44),mode:"resolve",status:"intent_obsolete",assignment:null},error:null});
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));await screen.findByText(/Chưa có kết quả xác nhận/);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await waitFor(()=>expect(p.invoke).toHaveBeenCalledTimes(2));
 expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);expect(p.onSettled).not.toHaveBeenCalled();
});
it("legacy attention and resolver outages preserve intent without enabling retry",async()=>{
 const p=props();p.invoke.mockResolvedValueOnce({data:{...intent,mode:"resolve",status:"legacy_receipt_review_required",assignment:null},error:null})
  .mockResolvedValueOnce({data:null,error:{message:"resolution unavailable"}});
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await screen.findByText(/Có dấu gán legacy/);
 expect(screen.queryByRole("button",{name:"Gửi lại đúng yêu cầu gán"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));
 await screen.findByText("resolution unavailable");expect(sessionStorage.getItem(key)).toBe(intent.idempotency_key);expect(p.onSettled).not.toHaveBeenCalled();
});
it("resolver receipt wins as committed rather than obsolete",async()=>{
 const p=props();p.invoke.mockResolvedValue({data:{...receipt().data,mode:"resolve"},error:null});render(<ManualAssignmentRecovery {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await waitFor(()=>expect(p.onSettled).toHaveBeenCalledWith(intent,"committed"));
});
it("late obsolete proof cannot delete a replaced journal",async()=>{
 const p=props();let finish!:(v:unknown)=>void;p.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<ManualAssignmentRecovery {...p}/>);fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));sessionStorage.setItem(key,id(88));
 await act(async()=>finish({data:{...intent,mode:"resolve",status:"intent_obsolete",assignment:null},error:null}));
 expect(sessionStorage.getItem(key)).toBe(id(88));expect(p.onSettled).not.toHaveBeenCalled();
});
