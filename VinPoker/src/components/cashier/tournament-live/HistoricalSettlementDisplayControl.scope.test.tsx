import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoricalSettlementDisplayControl } from "./HistoricalSettlementDisplayControl";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),error:vi.fn(),success:vi.fn(),actor:"81100000-0000-4000-8000-000000000001"}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:mocks.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>({functions:{invoke:mocks.invoke}})}));
vi.mock("sonner",()=>({toast:{error:mocks.error,success:mocks.success}}));
vi.mock("@/lib/tracker-poker/historicalSettlementDisplay",()=>({parseHistoricalSettlementDisplayPreview:(data:{hand_id:string},key:string)=>({handId:data.hand_id,idempotencyKey:key,sourceRevision:1,sourceChainHash:"a".repeat(64),outcomeHash:"b".repeat(64),settlement:{players:[],handRanks:[]}})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.resetAllMocks();sessionStorage.clear();mocks.actor="81100000-0000-4000-8000-000000000001";});
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
