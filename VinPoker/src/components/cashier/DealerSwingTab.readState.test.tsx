import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session:{access_token:'synthetic-a'},candidateSignals:[] as AbortSignal[],candidateResolves:[] as Array<(value:unknown)=>void>,candidateHang:false, actorId: "actor", error: "503 TEST" as string | null, loading: false, dealerError:null as string|null, dealerLoading:false, configError: null as string | null, configLoading: false, tournamentError:false,tournamentLoading:false,tournamentRefetch:vi.fn(), configRefetch: vi.fn() }));
const tableState=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],assignments:[] as Record<string,unknown>[],scheduleRefetch:vi.fn()}));
vi.mock("@/lib/featureFlags", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/featureFlags")>();
  return { ...original, FEATURES: { ...original.FEATURES, floorTableControlV3: true } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId },session:state.session, isClubAdmin: true, isAdmin: false, isClubOwner: true, isFloor: false }) }));
vi.mock("@/hooks/useDealerSwing", () => {
  const query = () => ({ data: [], loading: false, error: null, refetch: vi.fn() });
  return {
    useCheckedInDealers: query, useTodayCheckedOutDealers: query,
    useDealerOperationalTables: () => ({ ...query(), data:tableState.rows,error: state.error, loading: state.loading }),
    useActiveAssignmentsWithTimeline: () => ({ ...query(),data:tableState.assignments, activeRawData:tableState.assignments }),
    useSwingConfigs: () => ({ ...query(), error: state.configError, loading: state.configLoading, refetch: state.configRefetch }), useSwingMetrics: query, useSpecialDates: query, useBreakPool: query,
    useAuditLogs: () => [], useBreakPolicies: () => [], usePreAssignedDealers: () => ({}),
    useOptimisticDealerCount: () => ({ optimistic: 0, onCheckout: vi.fn() }),
    useNextDealerPredictions: () => ({ data: {} }),
  };
});
vi.mock("@/hooks/useRotationSchedule", () => ({ useRotationSchedule: () => ({ rows: [], byTableId: {}, loading: false, error: null, refetch:tableState.scheduleRefetch }) }));
vi.mock('./ChangePredictedDealerModal',()=>({default:({onChanged}:{onChanged:()=>void})=><button onClick={onChanged}>TEST accept canonical next receipt</button>}));
// Parent invalidation contract, not Radix popover or RPC acceptance (tested separately).
vi.mock('./dealer-swing/SwingTableCard',()=>({default:({table,onChangePredicted}:{table:{id:string};onChangePredicted:(id:string)=>void})=><button onClick={()=>onChangePredicted(table.id)}>TEST open next dealer</button>}));
vi.mock("@/hooks/useTournaments", () => ({ useActiveTournaments: () => ({ data: [],isError:state.tournamentError,isLoading:state.tournamentLoading,refetch:state.tournamentRefetch }) }));
vi.mock("@/hooks/useDealerManagement", () => ({ useAllDealers: () => ({ data: [],error:state.dealerError,loading:state.dealerLoading }), useDealerScores: () => ({ data: [] }) }));
vi.mock("@/hooks/useDealerSwingHealth", () => ({ useDealerSwingHealth: () => ({ data: null, unavailable: true }) }));
vi.mock("@/hooks/useLiveClock", () => ({ useLiveClock: () => 0 }));
vi.mock("@/hooks/useSwingAnimation", () => ({ useSwingAnimation: () => ({}) }));
vi.mock("@/hooks/useFocusNavigation", () => ({ useFocusNavigation: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table:string) => {
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), is:vi.fn(),range:vi.fn(),limit:vi.fn(),or:vi.fn(),abortSignal:vi.fn(), order: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
  for (const key of ["select", "eq", "in", "order","is","range","limit","or","abortSignal"]) query[key as "select"].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  query.abortSignal.mockImplementation((signal:AbortSignal)=>{if(table==='dealers'||table==='dealer_attendance')state.candidateSignals.push(signal);return query;});
  query.then.mockImplementation((resolve) => {if(!state.candidateHang)resolve({ data: [],count:0, error: null });else state.candidateResolves.push(resolve);});
  return query;};
  return { supabase: { from, rpc: vi.fn().mockResolvedValue({ data: null, error: null }), functions: { invoke: vi.fn() } } };
});
import SwingPanel from "./DealerSwingTab";
import { supabase } from "@/integrations/supabase/client";

describe("desktop Swing authoritative read state", () => {
  beforeEach(() => { tableState.rows=[];tableState.assignments=[];tableState.scheduleRefetch.mockClear();state.candidateSignals=[];state.candidateResolves=[];state.candidateHang=false;state.actorId = "actor"; state.error = "503 TEST"; state.loading = false; state.dealerError=null;state.dealerLoading=false; state.configError = null; state.configLoading = false; state.configRefetch.mockClear();state.tournamentError=false;state.tournamentLoading=false;state.tournamentRefetch.mockClear(); });
  it('does not present unverified tournament timing as usable Swing data and explicitly retries its read',async()=>{
    state.error=null;state.tournamentError=true;
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được dữ liệu Dealer Swing');
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    expect(state.tournamentRefetch).toHaveBeenCalledOnce();
    state.tournamentError=false;
    await act(async()=>view.rerender(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>));
    expect(screen.queryByText('Không xác minh được dữ liệu Dealer Swing')).toBeNull();
  });
  it('keeps Swing awaiting verification while active tournament timing is loading',async()=>{
    state.error=null;state.tournamentLoading=true;
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    expect(screen.getByRole('status')).toHaveTextContent('Đang xác minh dữ liệu Dealer Swing');
  });
  it('refreshes the authoritative rotation schedule after accepting a next-dealer receipt without waiting for Realtime',async()=>{
    state.error=null;
    tableState.rows=[{id:'table',club_id:'club',table_name:'TEST assigned table',table_number:30,table_type:'tournament',status:'active',availability_status:'in_use',table_session_id:'session',tournament_id:null,opened_at:null}];
    tableState.assignments=[{id:'assignment',table_id:'table',table_session_id:'session',club_id:'club',attendance_id:'serving',status:'assigned',released_at:null,version:0,assigned_at:'2026-10-24T01:00:00Z',swing_due_at:'2026-10-24T02:00:00Z',pre_assign_status:'none',dealer_attendance:{current_state:'assigned',dealers:{full_name:'TEST serving'}}}];
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'TEST open next dealer'}));});
    expect(tableState.scheduleRefetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'TEST accept canonical next receipt'}));
    expect(tableState.scheduleRefetch).toHaveBeenCalledOnce();
  });
  afterEach(()=>vi.useRealTimers());
  it('shows suggestion failure with explicit retry instead of an endless loading label',async()=>{
    state.error=null;
    tableState.rows=[{id:'table',club_id:'club',table_name:'TEST table',table_number:30,table_type:'tournament',status:'active',availability_status:'in_use',table_session_id:'session',tournament_id:null,opened_at:null}];
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:null,error:new Error('503 TEST')} as never);
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Gán dealer'})[0]);});
    expect(screen.queryByText('Đang tìm dealer phù hợp...')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('Không tải được gợi ý dealer');
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:{suggestions:[],diagnostics:null},error:null});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử lại gợi ý'}));});
    expect(screen.getByRole('dialog')).toHaveTextContent('Không có dealer sẵn sàng.');
  });
  it('does not let a late suggestion error for a closed table overwrite the next dialog',async()=>{
    state.error=null;
    tableState.rows=['one','two'].map((id,index)=>({id,club_id:'club',table_name:'TEST '+id,table_number:30+index,table_type:'tournament',status:'active',availability_status:'in_use',table_session_id:'session-'+id,tournament_id:null,opened_at:null}));
    let resolveFirst!:(value:unknown)=>void;
    vi.mocked(supabase.functions.invoke).mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;}) as never);
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Gán dealer'})[0]);});
    fireEvent.click(screen.getByRole('button',{name:'Close'}));
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:{suggestions:[],diagnostics:null},error:null});
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Gán dealer'})[1]);});
    await act(async()=>{resolveFirst({data:null,error:new Error('late503')});});
    expect(screen.getByRole('dialog')).toHaveTextContent('Không có dealer sẵn sàng.');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Không tải được gợi ý dealer');
  });
  it('does not interpret malformed suggestion data as a verified empty pool',async()=>{
    state.error=null;
    tableState.rows=[{id:'table',club_id:'club',table_name:'TEST table',table_number:30,table_type:'tournament',status:'active',availability_status:'in_use',table_session_id:'session',tournament_id:null,opened_at:null}];
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:null,error:null});
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Gán dealer'})[0]);});
    expect(screen.getByRole('dialog')).toHaveTextContent('Không tải được gợi ý dealer');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Không có dealer sẵn sàng.');
  });
  it('discards open Swing configuration after same-actor session replacement',async()=>{
    state.error=null;state.session={access_token:'synthetic-a'};
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<SwingPanel {...props}/>);});
    fireEvent.click(screen.getByRole('button',{name:'Cấu hình Swing'}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    state.session={access_token:'synthetic-b'};
    await act(async()=>view.rerender(<SwingPanel {...props}/>));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('bounds a hung check-in candidate read without allowing a mutation',async()=>{
    state.error=null;
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    fireEvent.click(screen.getByRole('button',{name:'ĐỘI HÌNH / CHECK-IN'}));
    state.candidateHang=true;vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button',{name:'Check-in'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(15001);});
    expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được trạng thái ca');
    expect(screen.getByRole('button',{name:'Tải lại trạng thái ca'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Check-in (0)'})).toBeDisabled();
    expect(state.candidateSignals).toHaveLength(2);
    expect(state.candidateSignals.every(signal=>signal.aborted)).toBe(true);
    state.candidateHang=false;
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Tải lại trạng thái ca'}));});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Không có dealer phù hợp trong CLB đã chọn.')).toBeInTheDocument();
    await act(async()=>{for(const finish of state.candidateResolves)finish({data:null,error:{message:'late old read'}});});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith('operator_check_in_dealer_v1',expect.anything());
  });
  it.each(['error','loading'])('does not report a verified total while dealer read is %s',async(kind)=>{
    state.error=null;state.dealerError=kind==='error'?'503 dealers':null;state.dealerLoading=kind==='loading';
    await act(async()=>{render(<SwingPanel clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);});
    fireEvent.click(screen.getByRole('button',{name:'ĐỘI HÌNH / CHECK-IN'}));
    expect(screen.getByText('Tổng dealer chưa xác minh')).toBeInTheDocument();
    expect(screen.queryByText('đang hoạt động')).not.toBeInTheDocument();
  });
  it("blocks operations when config is unavailable instead of using fallback timing", async () => {
    state.error = null; state.configError = "503 config";
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Cấu hình Swing$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(state.configRefetch).toHaveBeenCalledOnce();
  });
  it("keeps emergency OFF available while config is being verified", async () => {
    state.error = null; state.configLoading = true;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Cấu hình Swing$/ })).not.toBeInTheDocument();
  });
  it("exposes declaration in the verified single-club workspace without opening a session", async () => {
    state.error = null;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    fireEvent.click(screen.getByRole("button", { name: /physicalTableDeclaration.action|Khai báo bàn vật lý|Declare physical table/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith("declare_club_physical_table_v1", expect.anything());
  });
  it("blocks operational rendering on failed inventory but retains emergency OFF", async () => {
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Check-in/ })).not.toBeInTheDocument();
  });
  it("does not report a ready floor during initial verification", async () => {
    state.error = null; state.loading = true;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    expect(screen.getByRole("status")).toHaveTextContent("Đang");
    expect(screen.getByRole("button", { name: "⏹ Dừng Swing" })).toBeEnabled();
  });
  it("discards an open configuration dialog after actor changes within the same club", async () => {
    state.error = null;
    const props = { clubIds: ["club"], clubs: [{ id: "club", name: "TEST" }] };
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<SwingPanel {...props} />); });
    fireEvent.click(screen.getByRole("button", { name: /^Cấu hình Swing$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    state.actorId = "actor-b";
    await act(async () => { view.rerender(<SwingPanel {...props} />); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("distinguishes the configured rest preference from the automatic server floor", async () => {
    state.error = null;
    await act(async () => { render(<SwingPanel clubIds={["club"]} clubs={[{ id: "club", name: "TEST" }]} />); });
    fireEvent.click(screen.getByRole("button", { name: /^Cấu hình Swing$/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Tự động gán dealer luôn yêu cầu nghỉ ít nhất 15 phút");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Dealer phải nghỉ tối thiểu 10 phút trước khi được xếp ca mới.");
  });
});
