import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoricalSettlementDisplayControl } from "./HistoricalSettlementDisplayControl";
import { historicalCommitKey, persistHistoricalCommitJournal, type HistoricalCommitIntent } from "@/lib/tracker-poker/historicalCommitIntent";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),error:vi.fn(),success:vi.fn(),actor:"81100000-0000-4000-8000-000000000001"}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:mocks.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>({functions:{invoke:mocks.invoke}})}));
vi.mock("sonner",()=>({toast:{error:mocks.error,success:mocks.success}}));
vi.mock("@/lib/tracker-poker/historicalSettlementDisplay",()=>({parseHistoricalSettlementDisplayPreview:(data:{hand_id:string},key:string)=>({handId:data.hand_id,idempotencyKey:key,sourceRevision:1,sourceChainHash:"a".repeat(64),outcomeHash:"b".repeat(64),settlement:{players:[],handRanks:[]}})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();sessionStorage.clear();mocks.actor="81100000-0000-4000-8000-000000000001";});
it("releases a stalled preview and ignores its late reply without issuing another operation",async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 try{
  render(<HistoricalSettlementDisplayControl tournamentId="tour" handId="hand" handNumber={1} onVerified={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
  expect(screen.getByRole("button",{name:"Xem trước xác minh"})).not.toBeDisabled();
  await act(async()=>resolve({data:{ok:true,hand_id:"hand"},error:null}));
  expect(screen.queryByText("Server đã xác minh outcome, chưa ghi gì vào dữ liệu hand.")).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
it("also bounds parsing a stalled Edge error body",async()=>{
 vi.useFakeTimers();
 mocks.invoke.mockResolvedValue({data:null,error:{context:{status:503,clone:()=>({json:()=>new Promise(()=>{})})}}});
 try{
  render(<HistoricalSettlementDisplayControl tournamentId="tour" handId="hand" handNumber={1} onVerified={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);});
  expect(screen.getByRole("button",{name:"Xem trước xác minh"})).not.toBeDisabled();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
for(const returnToA of [false,true])it(`does not apply old preview after context change (ABA=${returnToA})`,async()=>{
 let resolve!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const verified=vi.fn();const props={handNumber:1,onVerified:verified};
 const view=render(<HistoricalSettlementDisplayControl {...props} tournamentId="tour-a" handId="hand-a" />);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
 view.rerender(<HistoricalSettlementDisplayControl {...props} tournamentId="tour-b" handId="hand-b" />);
 if(returnToA)view.rerender(<HistoricalSettlementDisplayControl {...props} tournamentId="tour-a" handId="hand-a" />);
 await act(async()=>resolve({data:{ok:true,status:"preview",hand_id:"hand-a"},error:null}));
 expect(screen.queryByText("Server đã xác minh outcome, chưa ghi gì vào dữ liệu hand.")).not.toBeInTheDocument();
 expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(verified).not.toHaveBeenCalled();
});
it("ignores a preview response from the previous account",async()=>{
 let resolve!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const props={tournamentId:"tour",handId:"hand",handNumber:1,onVerified:vi.fn()};
 const view=render(<HistoricalSettlementDisplayControl {...props} />);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
 mocks.actor="other-owner";view.rerender(<HistoricalSettlementDisplayControl {...props} />);
 await act(async()=>resolve({data:{ok:true,hand_id:"hand"},error:null}));
 expect(screen.queryByText("Server đã xác minh outcome, chưa ghi gì vào dữ liệu hand.")).not.toBeInTheDocument();
});
it("does not publish a late commit acknowledgement into another hand",async()=>{
 const hand="86000000-0000-4000-8000-000000000001";
 mocks.invoke.mockResolvedValueOnce({data:{ok:true,hand_id:hand},error:null});
 let resolve!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const onVerified=vi.fn();const props={tournamentId:"85000000-0000-4000-8000-000000000001",handId:hand,handNumber:1,onVerified};
 const view=render(<HistoricalSettlementDisplayControl {...props} />);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
 fireEvent.click(await screen.findByRole("button",{name:"Lưu outcome hiển thị đã xác minh"}));
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu hiển thị"}));
 view.rerender(<HistoricalSettlementDisplayControl {...props} handId="hand-b" />);
 await act(async()=>resolve({data:{ok:true},error:null}));
 expect(onVerified).not.toHaveBeenCalled();expect(mocks.success).not.toHaveBeenCalled();
});
it("persists before commit and recovers a lost response after remount using only the original receipt",async()=>{
 const props={tournamentId:"85000000-0000-4000-8000-000000000001",handId:"86000000-0000-4000-8000-000000000001",handNumber:1,onVerified:vi.fn()};
 let found=false;const writes:unknown[]=[];
 mocks.invoke.mockImplementation(async(_name,{body})=>{
  if(body.mode==="preview")return {data:{ok:true,hand_id:props.handId},error:null};
  if(body.mode==="commit"){expect(sessionStorage.length).toBe(1);writes.push(body);throw new TypeError("lost response");}
  expect(body.mode).toBe("receipt");const state={ok:true,status:found?"receipt_found":"receipt_not_found",
   actor_id:body.expected_actor_id,tournament_id:body.tournament_id,hand_id:body.hand_id,idempotency_key:body.idempotency_key,
   source_revision:body.expected_source_revision,source_chain_hash:body.expected_source_chain_hash,outcome_hash:body.expected_outcome_hash,
   receipt:found?{ok:true,idempotent:true,settlement_revision:1,source_revision:body.expected_source_revision,outcome_hash:body.expected_outcome_hash}:null};
  return {data:state,error:null};
 });
 const first=render(<HistoricalSettlementDisplayControl {...props} />);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
 fireEvent.click(await screen.findByRole("button",{name:"Lưu outcome hiển thị đã xác minh"}));
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu hiển thị"}));
 await act(async()=>{});expect(writes).toHaveLength(1);expect(sessionStorage.length).toBe(1);
 first.unmount();found=true;render(<HistoricalSettlementDisplayControl {...props} />);
 expect(screen.getByRole("button",{name:"Xem trước xác minh"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra receipt yêu cầu cũ"}));
 await act(async()=>{});expect(writes).toHaveLength(1);expect(sessionStorage.length).toBe(0);expect(props.onVerified).toHaveBeenCalledOnce();
});
it("does not send a commit when durable browser storage is unavailable",async()=>{
 const hand="86000000-0000-4000-8000-000000000001";
 mocks.invoke.mockResolvedValue({data:{ok:true,hand_id:hand},error:null});
 render(<HistoricalSettlementDisplayControl tournamentId="85000000-0000-4000-8000-000000000001" handId={hand} handNumber={1} onVerified={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước xác minh"}));
 fireEvent.click(await screen.findByRole("button",{name:"Lưu outcome hiển thị đã xác minh"}));
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage denied");});
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu hiển thị"}));await act(async()=>{});
 expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(screen.getByRole("alert")).toHaveTextContent("chưa gửi commit History");
});
const pendingIntent=():HistoricalCommitIntent=>({expected_actor_id:mocks.actor,tournament_id:"85000000-0000-4000-8000-000000000001",
 hand_id:"86000000-0000-4000-8000-000000000001",idempotency_key:"history-explicit-retry-0001",expected_source_revision:1,
 expected_source_chain_hash:"a".repeat(64),expected_outcome_hash:"b".repeat(64)});
const receiptEnvelope=(intent:HistoricalCommitIntent,found:boolean)=>({ok:true,status:found?"receipt_found":"receipt_not_found",
 actor_id:intent.expected_actor_id,tournament_id:intent.tournament_id,hand_id:intent.hand_id,idempotency_key:intent.idempotency_key,
 source_revision:intent.expected_source_revision,source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,
 receipt:found?{ok:true,idempotent:true,settlement_revision:1,source_revision:intent.expected_source_revision,outcome_hash:intent.expected_outcome_hash}:null});
for(const state of ["obsolete","found","unknown","malformed"])it(`explicit server resolution handles ${state} without any writer`,async()=>{
 const intent=pendingIntent();persistHistoricalCommitJournal(sessionStorage,intent);
 const value={...receiptEnvelope(intent,state==="found"),current_source_revision:state==="unknown"||state==="malformed"?1:2,
  status:state==="obsolete"||state==="malformed"?"intent_obsolete":state==="found"?"receipt_found":"receipt_not_found"};
 mocks.invoke.mockResolvedValue({data:value,error:null});const onVerified=vi.fn();
 render(<HistoricalSettlementDisplayControl tournamentId={intent.tournament_id} handId={intent.hand_id} handNumber={1} onVerified={onVerified}/>);
 fireEvent.click(screen.getByRole("button",{name:"Đối chiếu revision yêu cầu cũ"}));await act(async()=>{});
 expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("tournament-historical-settlement",{body:{mode:"resolve",...intent}});
 expect(sessionStorage.length).toBe(state==="obsolete"||state==="found"?0:1);
 expect(onVerified).toHaveBeenCalledTimes(state==="obsolete"||state==="found"?1:0);
});
for(const changed of ["actor","journal"])it(`does not clear a pending request when ${changed} changes during resolution`,async()=>{
 const intent=pendingIntent();persistHistoricalCommitJournal(sessionStorage,intent);
 let finish!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
 const props={tournamentId:intent.tournament_id,handId:intent.hand_id,handNumber:1,onVerified:vi.fn()};
 const view=render(<HistoricalSettlementDisplayControl {...props}/>);
 fireEvent.click(screen.getByRole("button",{name:"Đối chiếu revision yêu cầu cũ"}));
 if(changed==="actor"){mocks.actor="other-actor";view.rerender(<HistoricalSettlementDisplayControl {...props}/>);}
 else sessionStorage.setItem(historicalCommitKey(intent),JSON.stringify({...intent,idempotency_key:"later-different-key"}));
 await act(async()=>finish({data:{...receiptEnvelope(intent,false),status:"intent_obsolete",current_source_revision:2},error:null}));
 expect(sessionStorage.length).toBe(1);expect(props.onVerified).not.toHaveBeenCalled();
});
it("explicit retry reads first and reuses the unchanged persisted key and CAS",async()=>{
 const intent=pendingIntent();persistHistoricalCommitJournal(sessionStorage,intent);vi.spyOn(window,"confirm").mockReturnValue(true);
 const writes:unknown[]=[];const modes:string[]=[];
 mocks.invoke.mockImplementation(async(_name,{body})=>{modes.push(body.mode);
  if(body.mode==="commit"){writes.push(body);return {data:{ok:true},error:null};}
  return {data:receiptEnvelope(intent,writes.length>0),error:null};
 });
 const verified=vi.fn();render(<HistoricalSettlementDisplayControl tournamentId={intent.tournament_id} handId={intent.hand_id} handNumber={1} onVerified={verified} />);
 const retry=screen.getByRole("button",{name:"Kiểm tra rồi gửi lại cùng mã"});fireEvent.click(retry);fireEvent.click(retry);await act(async()=>{});
 expect(modes).toEqual(["receipt","commit","receipt"]);expect(writes).toEqual([{mode:"commit",...intent}]);
 expect(sessionStorage.length).toBe(0);expect(verified).toHaveBeenCalledOnce();
});
for(const outcome of ["found","unavailable","declined"])it(`does not resend a pending commit when receipt is ${outcome}`,async()=>{
 const intent=pendingIntent();persistHistoricalCommitJournal(sessionStorage,intent);vi.spyOn(window,"confirm").mockReturnValue(outcome!=="declined");
 mocks.invoke.mockResolvedValue(outcome==="unavailable"?{data:null,error:Error("503")}:{data:receiptEnvelope(intent,true),error:null});
 render(<HistoricalSettlementDisplayControl tournamentId={intent.tournament_id} handId={intent.hand_id} handNumber={1} onVerified={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra rồi gửi lại cùng mã"}));await act(async()=>{});
 expect(mocks.invoke.mock.calls.every(([,parameters])=>parameters.body.mode==="receipt")).toBe(true);
 expect(mocks.invoke).toHaveBeenCalledTimes(outcome==="declined"?0:1);
 expect(sessionStorage.length).toBe(outcome==="found"?0:1);
});
for(const change of ["account","journal"])it(`does not resend after ${change} changes during the receipt read`,async()=>{
 const intent=pendingIntent();persistHistoricalCommitJournal(sessionStorage,intent);vi.spyOn(window,"confirm").mockReturnValue(true);
 let resolve!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const verified=vi.fn();const props={tournamentId:intent.tournament_id,handId:intent.hand_id,handNumber:1,onVerified:verified};
 const view=render(<HistoricalSettlementDisplayControl {...props} />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra rồi gửi lại cùng mã"}));
 if(change==="account"){mocks.actor="81300000-0000-4000-8000-000000000001";view.rerender(<HistoricalSettlementDisplayControl {...props} />);}
 else sessionStorage.setItem(sessionStorage.key(0)!,JSON.stringify({...intent,idempotency_key:"history-replacement-request-0002"}));
 await act(async()=>resolve({data:receiptEnvelope(intent,false),error:null}));
 expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
 if(change==="journal")expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).idempotency_key).toBe("history-replacement-request-0002");
});
