import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoricalSettlementBatchControl } from "./HistoricalSettlementBatchControl";
import { historicalCommitKey, persistHistoricalCommitJournal } from "@/lib/tracker-poker/historicalCommitIntent";
const m=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),success:vi.fn(),warning:vi.fn(),actor:"81000000-0000-0000-0000-000000000001"}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:m.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>({rpc:m.rpc,functions:{invoke:m.invoke}})}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{trackerHistoricalSettlementBulk:true}}));
vi.mock("sonner",()=>({toast:{success:m.success,warning:m.warning}}));
vi.mock("@/lib/tracker-poker/historicalSettlementDisplay",()=>({parseHistoricalSettlementDisplayPreview:(data:{hand_id:string},key:string)=>({handId:data.hand_id,idempotencyKey:key,sourceRevision:1,sourceChainHash:"a".repeat(64),outcomeHash:"b".repeat(64),settlement:{players:[],handRanks:[]}})}));
vi.mock("@/lib/tracker-poker/replaySettlement",()=>({parseReplayPublicSettlement:(data:{verified?:boolean}|null)=>data?.verified?data:null}));
const candidates=[1,2].map(n=>({handId:`86000000-0000-0000-0000-00000000000${n}`,handNumber:n,tableId:"table"}));
it("does not start a new preview after the canonical proof read fails",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"503 unavailable"}});
 m.invoke.mockResolvedValue({data:{ok:false},error:null});
 render(<HistoricalSettlementBatchControl tournamentId="85000000-0000-0000-0000-000000000001" candidates={[candidates[0]]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 await screen.findByRole("button",{name:"Hand #1 Không đọc được proof hiện tại; thử kiểm tra lại"});
 expect(m.invoke).not.toHaveBeenCalled();
});
for(const proofAvailable of [false,true])it(`requires canonical proof after an already-exists diagnostic (${proofAvailable})`,async()=>{
 m.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:proofAvailable?{verified:true}:null,error:null});
 m.invoke.mockResolvedValue({data:{ok:false,code:"historical_settlement_already_exists"},error:null});
 render(<HistoricalSettlementBatchControl tournamentId="85000000-0000-0000-0000-000000000001" candidates={[candidates[0]]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 await screen.findByRole("button",{name:proofAvailable?"Hand #1 Đã xác minh":"Hand #1 Outcome đã tồn tại; chưa xác minh proof hiện tại"});
 expect(m.rpc).toHaveBeenCalledTimes(2);
 expect(m.invoke).toHaveBeenCalledTimes(1);
});
afterEach(()=>{cleanup();sessionStorage.clear();vi.resetAllMocks();m.actor="81000000-0000-0000-0000-000000000001";});
it("reads an unresolved original receipt instead of minting another batch preview",async()=>{
 m.actor="81000000-0000-0000-0000-000000000001";
 const intent={expected_actor_id:m.actor,tournament_id:"85000000-0000-0000-0000-000000000001",
  hand_id:"86000000-0000-0000-0000-000000000001",idempotency_key:"original-unknown-request",expected_source_revision:1,
  expected_source_chain_hash:"a".repeat(64),expected_outcome_hash:"b".repeat(64)};
 persistHistoricalCommitJournal(sessionStorage,intent);
 m.rpc.mockResolvedValue({data:null,error:null});m.invoke.mockResolvedValue({data:null,error:{message:"offline"}});
 render(<HistoricalSettlementBatchControl tournamentId={intent.tournament_id}
  candidates={[{handId:intent.hand_id,handNumber:1,tableId:"table"}]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 await waitFor(()=>expect(m.invoke).toHaveBeenCalledTimes(1));
 expect(m.invoke).toHaveBeenCalledWith("tournament-historical-settlement",{body:{mode:"receipt",...intent}});
 expect(m.rpc).not.toHaveBeenCalled();
});
for(const aba of [false,true])it(`stops old preview work after changing tournament (ABA=${aba})`,async()=>{
 let resolve!:(value:unknown)=>void;m.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 m.rpc.mockResolvedValue({data:null,error:null});m.invoke.mockImplementation(async(_name,{body})=>({data:{ok:true,hand_id:body.hand_id},error:null}));
 const props={candidates,onSelectHand:vi.fn(),onCommitted:vi.fn()};
 const view=render(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000001" />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 2 hand"}));
 view.rerender(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000002" />);
 if(aba)view.rerender(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000001" />);
 await act(async()=>resolve({data:null,error:null}));
 expect(m.invoke).not.toHaveBeenCalled();expect(m.success).not.toHaveBeenCalled();
});
it("does not let an old finally clear a new batch's busy state",async()=>{
 let old!:(value:unknown)=>void,next!:(value:unknown)=>void;
 m.rpc.mockImplementationOnce(()=>new Promise(done=>{old=done;})).mockImplementationOnce(()=>new Promise(done=>{next=done;}));
 m.rpc.mockResolvedValue({data:null,error:null});m.invoke.mockImplementation(async(_name,{body})=>({data:{ok:true,hand_id:body.hand_id},error:null}));
 const props={candidates,onSelectHand:vi.fn(),onCommitted:vi.fn()};
 const view=render(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000001" />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 2 hand"}));
 m.actor="other-owner";view.rerender(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000002" />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 2 hand"}));
 await act(async()=>old({data:null,error:null}));
 expect(screen.getByRole("button",{name:"Đang kiểm tra 0/2"})).toBeDisabled();expect(m.invoke).not.toHaveBeenCalled();
 await act(async()=>next({data:null,error:null}));
 await screen.findByRole("button",{name:"Lưu 2 hand đủ dữ liệu"});
 expect(m.invoke).toHaveBeenCalledTimes(2);
 for(const [,parameters] of m.invoke.mock.calls)expect(parameters.body.tournament_id).toBe("85000000-0000-0000-0000-000000000002");
});
it("stops the rest of an old commit batch after scope changes while its first write is pending",async()=>{
 m.rpc.mockResolvedValue({data:null,error:null});let resolve!:(value:unknown)=>void;
 m.invoke.mockImplementation(async(_name,{body})=>body.mode==="preview"?{data:{ok:true,hand_id:body.hand_id},error:null}:new Promise(done=>{resolve=done;}));
 const props={candidates,onSelectHand:vi.fn(),onCommitted:vi.fn()};
 const view=render(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000001" />);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 2 hand"}));
 fireEvent.click(await screen.findByRole("button",{name:"Lưu 2 hand đủ dữ liệu"}));
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu outcome hiển thị"}));
 await waitFor(()=>expect(m.invoke.mock.calls.filter(([,p])=>p.body.mode==="commit")).toHaveLength(1));
 view.rerender(<HistoricalSettlementBatchControl {...props} tournamentId="85000000-0000-0000-0000-000000000002" />);
 await act(async()=>resolve({data:{ok:true},error:null}));
 expect(m.invoke.mock.calls.filter(([,p])=>p.body.mode==="commit")).toHaveLength(1);
 expect(props.onCommitted).not.toHaveBeenCalled();
});
it("persists before lost commit and a second batch preview only reads its original receipt",async()=>{
 const tournamentId="85000000-0000-0000-0000-000000000001";
 const candidate=candidates[0];let sent:Record<string,unknown>|null=null;
 const key=historicalCommitKey({expected_actor_id:m.actor,tournament_id:tournamentId,hand_id:candidate.handId});
 m.rpc.mockResolvedValue({data:null,error:null});
 m.invoke.mockImplementation(async(_name,{body})=>{
  if(body.mode==="preview")return {data:{ok:true,hand_id:body.hand_id},error:null};
  if(body.mode==="commit"){
   sent=Object.fromEntries(Object.entries(body).filter(([name])=>name!=="mode"));
   expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(sent);
   throw new Error("lost response");
  }
  return {data:null,error:{message:"receipt unavailable"}};
 });
 const view=render(<HistoricalSettlementBatchControl tournamentId={tournamentId} candidates={[candidate]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 fireEvent.click(await screen.findByRole("button",{name:"Lưu 1 hand đủ dữ liệu"}));
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu outcome hiển thị"}));
 await screen.findByText("Chưa rõ kết quả; chọn hand để kiểm tra receipt");
 expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(sent);
 view.unmount();
 render(<HistoricalSettlementBatchControl tournamentId={tournamentId} candidates={[candidate]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 await waitFor(()=>expect(m.invoke.mock.calls.map(([,p])=>p.body.mode)).toEqual(["preview","commit","receipt","receipt"]));
 expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(sent);
});
it("leaves a stalled read after the bounded observation without dispatching a late preview",async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 m.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 try{
  render(<HistoricalSettlementBatchControl tournamentId="85000000-0000-0000-0000-000000000001" candidates={[candidates[0]]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
  expect(screen.getByRole("button",{name:"Kiểm tra 1 hand"})).not.toBeDisabled();
  await act(async()=>resolve({data:null,error:null}));
  expect(m.invoke).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
for(const currentProof of [false,true])it(`does not confuse immutable receipt with current proof (${currentProof})`,async()=>{
 const intent={expected_actor_id:m.actor,tournament_id:"85000000-0000-0000-0000-000000000001",
  hand_id:candidates[0].handId,idempotency_key:"prior-batch-request-key",expected_source_revision:1,
  expected_source_chain_hash:"a".repeat(64),expected_outcome_hash:"b".repeat(64)};
 persistHistoricalCommitJournal(sessionStorage,intent);
 m.invoke.mockResolvedValue({data:{ok:true,status:"receipt_found",actor_id:intent.expected_actor_id,
  tournament_id:intent.tournament_id,hand_id:intent.hand_id,idempotency_key:intent.idempotency_key,
  source_revision:1,source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,
  receipt:{ok:true,idempotent:true,settlement_revision:1,source_revision:1,outcome_hash:intent.expected_outcome_hash}},error:null});
 m.rpc.mockResolvedValue({data:currentProof?{verified:true}:null,error:null});
 render(<HistoricalSettlementBatchControl tournamentId={intent.tournament_id} candidates={[candidates[0]]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
 await screen.findByRole("button",{name:currentProof?"Hand #1 Đã xác minh":"Hand #1 Đã lưu yêu cầu cũ; proof hiện tại chưa xác minh"});
 expect(m.invoke).toHaveBeenCalledExactlyOnceWith("tournament-historical-settlement",{body:{mode:"receipt",...intent}});
 expect(sessionStorage.getItem(historicalCommitKey(intent))).toBeNull();
});
it("does not write when storage cannot persist a batch intent",async()=>{
 m.rpc.mockResolvedValue({data:null,error:null});
 m.invoke.mockImplementation(async(_name,{body})=>({data:{ok:true,hand_id:body.hand_id},error:null}));
 const setItem=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
 try{
  render(<HistoricalSettlementBatchControl tournamentId="85000000-0000-0000-0000-000000000001" candidates={[candidates[0]]} onSelectHand={vi.fn()} onCommitted={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Kiểm tra 1 hand"}));
  fireEvent.click(await screen.findByRole("button",{name:"Lưu 1 hand đủ dữ liệu"}));
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận lưu outcome hiển thị"}));
  await screen.findByText("Không lưu được outcome");
  expect(m.invoke.mock.calls.map(([,p])=>p.body.mode)).toEqual(["preview"]);
 }finally{setItem.mockRestore();}
});
