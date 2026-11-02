import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpsAuthProvider, useOpsAuth } from "./OpsAuthProvider";
import { useCorrectionCommitRecovery } from "@/components/cashier/tournament-live/useCorrectionCommitRecovery";
import { HandHistoryWorkspace } from "@/components/cashier/tournament-live/HandHistoryWorkspace";
import { MemoryRouter } from "react-router-dom";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const state = vi.hoisted(() => ({
  session: { user: { id: "81100000-0000-4000-8000-000000000001" }, access_token: "LOCAL_TEST_ONLY" },
}));
const reads=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}));
vi.mock("@/integrations/supabase/opsClient", () => ({ opsClient: {
  from:reads.from,rpc:reads.rpc,
  auth: {
    getSession: async () => ({ data: { session: state.session }, error: null }),
    getUser: async () => ({ data: { user: state.session.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  },
} }));

function Recovery() {
  const { user } = useOpsAuth();
  const recovery = useCorrectionCommitRecovery("tour", "hand", () => {}, user?.id);
  return <p>actor:{recovery.actorId}</p>;
}
function Gate() {
  const { loading, user } = useOpsAuth();
  return !loading && user ? <Recovery /> : <p>Verifying TEST session</p>;
}
afterEach(cleanup);
it("uses the verified Ops actor without mounting the public AuthProvider", async () => {
  render(<OpsAuthProvider><Gate /></OpsAuthProvider>);
  await waitFor(() => expect(screen.getByText(`actor:${state.session.user.id}`)).toBeInTheDocument());
});

function HistoryGate(){
 const {loading,user}=useOpsAuth();
 return !loading&&user?<MemoryRouter><HandHistoryWorkspace tournamentId="tour" initialHandId="hand" actorId={user.id} workspaceMode enableHistoricalBatchControls/></MemoryRouter>:<p>Verifying history TEST</p>;
}
it("mounts actual per-hand and batch History controls under Ops Auth only",async()=>{
 reads.rpc.mockImplementation(async(name:string)=>({data:name==='list_tracker_history_tables_v1'?{ok:true,tables:[]}:[],error:null}));
 reads.from.mockImplementation((table:string)=>{
  const data=table==='tournament_hands'?[{id:'hand',hand_number:1,table_id:null,created_at:'2026-10-20T00:00:00Z',
   status:'completed',community_cards:[],is_voided:false}]:[];
  const builder={select:()=>builder,eq:()=>builder,in:()=>builder,order:()=>builder,range:()=>builder,limit:()=>builder,
   then:(resolve: (v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve,reject)};
  return builder;
 });
 render(<OpsAuthProvider><HistoryGate/></OpsAuthProvider>);
 expect(await screen.findByRole('button',{name:'Xem trước xác minh'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Kiểm tra 1 hand'})).toBeTruthy();
});

it("rejects an archive whose next page repeats a previously loaded hand",async()=>{
 reads.rpc.mockImplementation(async(name:string)=>({data:name==='list_tracker_history_tables_v1'?{ok:true,tables:[]}:[],error:null}));
 const firstPage=Array.from({length:1000},(_,index)=>({id:`page-hand-${index}`,hand_number:index+1,table_id:null,
  created_at:'2026-10-20T00:00:00Z',status:'completed',community_cards:[],is_voided:false}));
 reads.from.mockImplementation((table:string)=>{
  let start=0;
  const builder={select:()=>builder,eq:()=>builder,in:()=>builder,order:()=>builder,
   range:(from:number)=>{start=from;return builder;},limit:()=>builder,
   then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve({
    data:table==='tournament_hands'?(start===0?firstPage:[firstPage[0]]):[],error:null,
   }).then(resolve,reject)};
  return builder;
 });
 render(<OpsAuthProvider><HistoryGate/></OpsAuthProvider>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Dữ liệu trang lịch sử bị trùng hoặc thiếu định danh. Hãy thử lại.');
 expect(screen.queryByRole('button',{name:'Kiểm tra 1001 hand'})).not.toBeInTheDocument();
});
