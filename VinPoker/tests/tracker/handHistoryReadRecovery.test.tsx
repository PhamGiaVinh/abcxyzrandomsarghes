import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } }));
const editor = vi.hoisted(() => ({ enabled: false }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => backend }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { trackerHistoryCompletionWorker: true, trackerHandHistoryEdit: true, trackerResettleForward: true }, isTrackerAtomicResettleAvailable: () => false }));
vi.mock("@/lib/tracker-poker/handPlayerNamesClient", () => ({
  handPlayersHasSnapshotForClient: async () => true,
  fetchHandPlayerDisplayForClient: async () => new Map(),
}));
// This seam supplies a draft; the actual parent orchestration/preview is rendered.
// Real editor/cardpicker and SQL are covered by the separate native journey.
vi.mock("@/components/cashier/tournament-live/HandEditPanel", () => ({
  HandEditPanel: ({ onResettle, onCancel, saving }: { onResettle: (...args: unknown[]) => unknown; onCancel: () => void; saving: boolean }) => editor.enabled
    ? <><button disabled={saving} onClick={() => { void onResettle({}, { community_cards: ["2c", "3d", "4h"] }, "TEST correction", [], []); }}>Preview draft TEST</button>
      <button onClick={onCancel}>Cancel draft TEST</button></> : null,
}));
vi.mock("@/components/cashier/tournament-live/FloorHandActionReview", () => ({ FloorHandActionReview: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementDisplayControl", () => ({ HistoricalSettlementDisplayWorkspace: () => null }));
vi.mock("@/components/cashier/tournament-live/HistoricalSettlementBatchControl", () => ({ HistoricalSettlementBatchWorkspace: () => null }));
vi.mock("@/components/cashier/tournament-live/resettleApply", () => ({
  runClientResettle: () => ({ result: { ok: true, targetWinnerIds: [], changes: [], summary: "modeled preview TEST" }, entryByPlayer: new Map(), entryByHandPlayer: new Map() }),
  buildServerSettlementEdit: () => ({ communityCards: ["2c", "3d", "4h"] }),
  resettleChipChanges: () => [], resettleHandEndStacks: () => ({ rows: [], conserved: true, beforeTotal: 0, afterTotal: 0 }),
  checkExpectedHandEndStacks: () => ({ rows: [], matchesEngine: true, expectedTotal: 0 }),
}));
vi.mock("@/components/cashier/tournament-live/handEditDiff", () => ({}));

import { HandHistoryWorkspace as Workspace, type HandHistoryPanelProps } from "@/components/cashier/tournament-live/HandHistoryWorkspace";
function HandHistoryWorkspace(props: HandHistoryPanelProps) {
  return <Workspace {...props} actorId={auth.user?.id} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const ok = (data: unknown[]) => ({ data, error: null });
const readFilters:unknown[][]=[];
function query(result: () => Promise<unknown>) {
  const builder = {
    select: () => builder, eq: (...args:unknown[]) => {readFilters.push(args);return builder;}, in: () => builder,
    order: () => builder, range: () => builder, gte: () => builder,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
  };
  return builder;
}
function hand(id: string, number: number) {
  return { id, hand_number: number, table_id: null, created_at: "2026-10-16T00:00:00Z", status: "completed", community_cards: [], is_voided: false };
}
beforeEach(() => {
  readFilters.length=0;
  auth.user = null;
  editor.enabled = false;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-a", 1)] : [])));
  // Keep table inventory unresolved so its independent effect does not trigger another load.
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? new Promise(() => {}) : Promise.resolve(ok([])));
});

it("does not discard an open draft when late table labels leave the archive filter unchanged", async () => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" }; editor.enabled = true;
  const tables = deferred<unknown>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? tables.promise : Promise.resolve(ok([])));
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("#1"));
  fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp sửa hand" }));
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeEnabled();
  const before = backend.from.mock.calls.filter(([table]) => table === "tournament_hands").length;
  await act(async () => tables.resolve({ data: { ok: true, tables: [{ tournament_table_id: "table-a", physical_table_id: "physical-a", table_name: "Table A" }] }, error: null }));
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeEnabled();
  expect(backend.from.mock.calls.filter(([table]) => table === "tournament_hands")).toHaveLength(before);
});

it("still retires the draft when inventory adds a physical alias to the selected table filter", async () => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" }; editor.enabled = true;
  const tables = deferred<unknown>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? tables.promise : Promise.resolve(ok([])));
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" initialTableId="table-a" initialHandId="hand-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Xem bản nháp sửa hand" }));
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeEnabled();
  const before = backend.from.mock.calls.filter(([table]) => table === "tournament_hands").length;
  await act(async () => tables.resolve({ data: { ok: true, tables: [{ tournament_table_id: "table-a", physical_table_id: "physical-a", table_name: "Table A" }] }, error: null }));
  expect(screen.queryByRole("button", { name: "Preview draft TEST" })).toBeNull();
  expect(backend.from.mock.calls.filter(([table]) => table === "tournament_hands").length).toBeGreaterThan(before);
});

it.each(['history','tables'])('keeps %s load errors and retry outside the hidden mobile hand picker',async(kind)=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
   ? kind==='tables'?{data:null,error:{message:'503 inventory TEST'}}:{data:{ok:true,tables:[]},error:null}:ok([])));
 backend.from.mockImplementation(()=>query(async()=>kind==='history'?{data:null,error:{message:'503 history TEST'}}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" workspaceMode initialHandId="hand-a"/></MemoryRouter>);
 const error=await screen.findByText(kind==='history'?/Không tải được lịch sử hand: 503 history TEST/:/Không tải được danh sách bàn: 503 inventory TEST/);
 expect(error.closest('.hidden')).toBeNull();
 const retry=await screen.findByRole('button',{name:kind==='history'?'Thử lại':'Tải lại danh sách bàn'});
 expect(retry.closest('.hidden')).toBeNull();
 expect(retry).toBeEnabled();
});
it('does not treat malformed successful table rows as an empty verified archive inventory',async()=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
  ?{data:{ok:true,tables:[{tournament_table_id:null,physical_table_id:null,table_name:null}]},error:null}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a' workspaceMode initialHandId='hand-a'/></MemoryRouter>);
 expect(await screen.findByText(/Không tải được danh sách bàn: Dữ liệu định danh bàn không hợp lệ/)).toBeVisible();
 expect(screen.getByRole('combobox',{name:'Lọc lịch sử theo bàn'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Tải lại danh sách bàn'})).toBeEnabled();
});
it('keeps closed and reopened archive instances distinct and filters the exact selected session',async()=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
  ?{data:{ok:true,tables:[
   {tournament_table_id:'closed-table',physical_table_id:'same-physical',table_name:'Table 2',table_status:'closed',table_session_id:'closed-session-281'},
   {tournament_table_id:'active-table',physical_table_id:'same-physical',table_name:'Table 2',table_status:'active',table_session_id:'active-session-281'},
  ]},error:null}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a' initialTableId='closed-table'/></MemoryRouter>);
 expect(await screen.findByRole('option',{name:'Table 2 · Đã đóng · closed-s'})).toBeVisible();
 expect(screen.getByRole('option',{name:'Table 2 · active-s'})).toBeVisible();
 await waitFor(()=>expect(readFilters).toContainEqual(['table_session_id','closed-session-281']));
 fireEvent.change(screen.getByRole('combobox',{name:'Lọc lịch sử theo bàn'}),{target:{value:'active-table'}});
 await waitFor(()=>expect(readFilters).toContainEqual(['table_session_id','active-session-281']));
});
it('rejects duplicate archive IDs rather than silently aliasing two options',async()=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
  ?{data:{ok:true,tables:[{tournament_table_id:'same',physical_table_id:'physical-1'},{tournament_table_id:'same',physical_table_id:'physical-2'}]},error:null}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a'/></MemoryRouter>);
 expect(await screen.findByText(/Dữ liệu định danh bàn không hợp lệ/)).toBeVisible();
 expect(backend.rpc.mock.calls.some(([name])=>name==='get_tournament_tables')).toBe(false);
});
it('does not guess the first session when a legacy physical deep link matches reopened tables',async()=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
  ?{data:{ok:true,tables:[
   {tournament_table_id:'closed-table',physical_table_id:'same-physical',table_name:'Table 2',table_status:'closed',table_session_id:'closed-session-281'},
   {tournament_table_id:'active-table',physical_table_id:'same-physical',table_name:'Table 2',table_status:'active',table_session_id:'active-session-281'},
  ]},error:null}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a' initialTableId='same-physical'/></MemoryRouter>);
 expect(await screen.findByText(/Bàn vật lý có nhiều phiên/)).toBeVisible();
 const picker=screen.getByRole('combobox',{name:'Lọc lịch sử theo bàn'});expect(picker).toBeEnabled();
 expect(picker).toHaveValue('same-physical');
 fireEvent.change(picker,{target:{value:'active-table'}});
 await waitFor(()=>expect(readFilters).toContainEqual(['table_session_id','active-session-281']));
});
it.each(['503','42501'])('does not fall back after archive RPC network/authority error %s',async(code)=>{
 backend.rpc.mockResolvedValue({data:null,error:{code,message:'LOCAL archive unavailable'}});
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a'/></MemoryRouter>);
 await screen.findByText(/Không tải được danh sách bàn: LOCAL archive unavailable/);
 expect(backend.rpc.mock.calls.some(([name])=>name==='get_tournament_tables')).toBe(false);
});
it('uses legacy metadata only for a genuinely absent archive RPC',async()=>{
 backend.rpc.mockImplementation((name:string)=>Promise.resolve(name==='list_tracker_history_tables_v1'
  ?{data:null,error:{code:'PGRST202',message:'LOCAL missing function'}}:name==='get_tournament_tables'
   ?{data:[{table_id:'legacy-physical',table_name:'Legacy table'}],error:null}:ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId='tour-a'/></MemoryRouter>);
 expect(await screen.findByRole('option',{name:'Legacy table'})).toBeVisible();
 expect(backend.rpc).toHaveBeenCalledWith('get_tournament_tables',{p_tournament_id:'tour-a'});
});

it.each(['in_progress','completed'])('distinguishes unfinalized stack from a real zero in a %s hand',async(status)=>{
 backend.from.mockImplementation((table:string)=>query(async()=>ok(table==='tournament_hands'
   ?[{...hand('hand-a',1),status}]:table==='hand_players'
   ?[{id:'hp-a',hand_id:'hand-a',player_id:'player',entry_number:1,player_name:'TEST PLAYER',seat_number:1,starting_stack:100,ending_stack:0,is_eliminated:false,hole_cards:[]}]:[])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" workspaceMode initialHandId="hand-a"/></MemoryRouter>);
 await screen.findByText('TEST PLAYER');
 if(status==='in_progress')expect(await screen.findByText('Chưa chốt')).toBeInTheDocument();
 else{
  expect(screen.queryByText('Chưa chốt')).toBeNull();
  expect(await screen.findByText('0',{selector:'span.text-red-400'})).toBeInTheDocument();
 }
});

it.each(["hand", "cancel", "refresh"])("does not restore a canceled preview in the rendered parent after %s change", async (change) => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" };editor.enabled = true;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands"
    ? [hand("hand-a", 1), hand("hand-b", 2)] : table === "hand_players"
      ? ["hand-a", "hand-b"].map(id => ({ id: id+"-player", hand_id: id, player_id: "player", entry_number: 1, seat_number: 1, starting_stack: 100, ending_stack: 100 })) : [])));
  const oldPreview = deferred<unknown>();backend.functions.invoke.mockReturnValue(oldPreview.promise);
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("#1"));
  fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp sửa hand" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" }));
  await waitFor(() => expect(backend.functions.invoke).toHaveBeenCalledTimes(1));
  if (change === "hand") fireEvent.click(screen.getByText("#2"));
  else if (change === "refresh") fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
  else fireEvent.click(screen.getByRole("button", { name: "Cancel draft TEST" }));
  fireEvent.click(await screen.findByRole("button", { name: "Xem bản nháp sửa hand" }));
  const ready = { data: { ok: true, status: "preview", draft_status: "READY_TO_APPLY", source_revision: 9,
    source_chain_hash: "a".repeat(64), outcome_hash: "b".repeat(64), request_hash: "c".repeat(64) }, error: null };
  await act(async () => { oldPreview.resolve(ready); });
  expect(screen.queryByText("Xem trước — tính lại chip")).not.toBeInTheDocument();
  backend.functions.invoke.mockResolvedValue(ready);
  fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" }));
  expect(await screen.findByText("Xem trước — tính lại chip")).toBeInTheDocument();
  expect(backend.functions.invoke.mock.calls[1][1].body.hand_id).toBe(change === "hand" ? "hand-b" : "hand-a");
  expect(backend.functions.invoke.mock.calls.every(([, args]) => args.body.mode === "preview")).toBe(true);
});

it.each(['json-data','http-context'])('shows the actionable bust guard from correction preview %s without a commit',async(kind)=>{
 auth.user={id:'81100000-0000-4000-8000-000000000001'};editor.enabled=true;
 backend.from.mockImplementation((table:string)=>query(async()=>ok(table==='tournament_hands'?[hand('hand-a',1)]
  :table==='hand_players'?[{id:'hp-a',hand_id:'hand-a',player_id:'player',entry_number:1,seat_number:1,starting_stack:100,ending_stack:100}]:[])));
 const failure={code:'bust_state_change_requires_void'};
 backend.functions.invoke.mockResolvedValue(kind==='json-data'?{data:failure,error:null}:{data:null,error:{message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify(failure),{status:422})}});
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a"/></MemoryRouter>);
 fireEvent.click(await screen.findByText('#1'));fireEvent.click(screen.getByRole('button',{name:'Xem bản nháp sửa hand'}));
 fireEvent.click(screen.getByRole('button',{name:'Preview draft TEST'}));
 await waitFor(()=>expect(notices.error).toHaveBeenCalledWith('Bản sửa làm thay đổi trạng thái bị loại/còn chơi. Không có thay đổi nào được lưu; hãy dùng Hoàn tác ván (void) rồi nhập lại theo quy trình.'));
 expect(screen.getByRole('button',{name:'Preview draft TEST'})).toBeEnabled();
 expect(screen.queryByText('Xem trước — tính lại chip')).not.toBeInTheDocument();
 expect(backend.functions.invoke).toHaveBeenCalledTimes(1);expect(backend.functions.invoke.mock.calls[0][1].body.mode).toBe('preview');
});

it.each(['malformed','unknown','prototype'])('does not expose a raw correction response body (%s) in the toast',async(kind)=>{
 auth.user={id:'81100000-0000-4000-8000-000000000001'};editor.enabled=true;
 backend.from.mockImplementation((table:string)=>query(async()=>ok(table==='tournament_hands'?[hand('hand-a',1)]
  :table==='hand_players'?[{id:'hp-a',hand_id:'hand-a',player_id:'player',entry_number:1,seat_number:1,starting_stack:100,ending_stack:100}]:[])));
 const context=new Response(kind==='malformed'?'<private-proxy-detail>':JSON.stringify({code:kind==='prototype'?'__proto__':'private-proxy-detail'}),{status:503});
 backend.functions.invoke.mockResolvedValue({data:null,error:{message:'private-proxy-detail',context}});
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a"/></MemoryRouter>);
 fireEvent.click(await screen.findByText('#1'));fireEvent.click(screen.getByRole('button',{name:'Xem bản nháp sửa hand'}));
 fireEvent.click(screen.getByRole('button',{name:'Preview draft TEST'}));
 await waitFor(()=>expect(notices.error).toHaveBeenCalledWith('Máy chủ chưa chấp nhận bản xem trước. Chưa có thay đổi nào được lưu; hãy kiểm tra dữ liệu và kết nối rồi thử lại.'));
 expect(context.bodyUsed).toBe(false);expect(screen.getByRole('button',{name:'Preview draft TEST'})).toBeEnabled();
 expect(backend.functions.invoke).toHaveBeenCalledTimes(1);
});

it.each(['cancel','timeout'])('bounds correction error-body reads and ignores late body after %s',async(kind)=>{
 auth.user={id:'81100000-0000-4000-8000-000000000001'};editor.enabled=true;
 backend.from.mockImplementation((table:string)=>query(async()=>ok(table==='tournament_hands'?[hand('hand-a',1)]
  :table==='hand_players'?[{id:'hp-a',hand_id:'hand-a',player_id:'player',entry_number:1,seat_number:1,starting_stack:100,ending_stack:100}]:[])));
 const late=deferred<unknown>(),json=vi.fn(()=>late.promise);
 backend.functions.invoke.mockResolvedValue({data:null,error:{message:'non-2xx',context:{clone:()=>({json})}}});
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a"/></MemoryRouter>);
 fireEvent.click(await screen.findByText('#1'));fireEvent.click(screen.getByRole('button',{name:'Xem bản nháp sửa hand'}));
 vi.useFakeTimers();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Preview draft TEST'}));});
 expect(json).toHaveBeenCalledTimes(1);
 if(kind==='cancel')fireEvent.click(screen.getByRole('button',{name:'Cancel draft TEST'}));
 else{
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
  expect(notices.error).toHaveBeenCalledWith('Hết thời gian xem trước. Chưa gửi thay đổi; hãy thử lại khi kết nối ổn định.');
  expect(screen.getByRole('button',{name:'Preview draft TEST'})).toBeEnabled();
 }
 const count=notices.error.mock.calls.length;
 await act(async()=>{late.resolve({code:'bust_state_change_requires_void'});});
 expect(notices.error).toHaveBeenCalledTimes(count);expect(screen.queryByText('Xem trước — tính lại chip')).not.toBeInTheDocument();
 expect(backend.functions.invoke).toHaveBeenCalledTimes(1);
});

it.each(["server", "chain", "detail"])("releases a hung %s preview read with a timeout and ignores its late response", async (phase) => {
  auth.user = { id: "81100000-0000-4000-8000-000000000001" };editor.enabled = true;
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-a", 1)]
    : table === "hand_players" ? [{ id: "hp-a", hand_id: "hand-a", player_id: "player", entry_number: 1, seat_number: 1, starting_stack: 100, ending_stack: 100 }] : [])));
  const latePreview = deferred<unknown>();backend.functions.invoke.mockReturnValue(latePreview.promise);
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  fireEvent.click(await screen.findByText("#1"));
  fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp sửa hand" }));
  if (phase === "chain") backend.from.mockImplementation(() => query(() => latePreview.promise));
  if (phase === "detail") backend.from.mockImplementation((table: string) => query(() => table === "hand_players" ? latePreview.promise
    : Promise.resolve(ok(table === "tournament_hands" ? [hand("hand-a", 1)] : []))));
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview draft TEST" })); });
  expect(backend.functions.invoke).toHaveBeenCalledTimes(phase === "server" ? 1 : 0);
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(notices.error).toHaveBeenCalledWith("Hết thời gian xem trước. Chưa gửi thay đổi; hãy thử lại khi kết nối ổn định.");
  expect(screen.getByRole("button", { name: "Preview draft TEST" })).toBeEnabled();
  await act(async () => { latePreview.resolve({ data: { ok: true, status: "preview", draft_status: "READY_TO_APPLY", source_revision: 9,
    source_chain_hash: "a".repeat(64), outcome_hash: "b".repeat(64), request_hash: "c".repeat(64) }, error: null }); });
  expect(screen.queryByText("Xem trước — tính lại chip")).not.toBeInTheDocument();
  expect(backend.functions.invoke).toHaveBeenCalledTimes(phase === "server" ? 1 : 0);
});

it.each(["actor-b", null])("invalidates hand/table reads on the same client and tournament after account becomes %s", async (nextActor) => {
  auth.user = { id: "actor-a" };
  const oldQueue = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1"
    ? Promise.resolve({ data: { ok: true, tables: [{ tournament_table_id: "table-a", physical_table_id:'physical-a', table_name: "Actor A table" }] }, error: null })
    : oldQueue.promise);
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  const nextRead = deferred<ReturnType<typeof ok>>(), nextTables = deferred<unknown>();
  backend.from.mockImplementation(() => query(() => nextRead.promise));
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? nextTables.promise : Promise.resolve(ok([])));
  auth.user = nextActor ? { id: nextActor } : null;
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Actor A table" })).not.toBeInTheDocument();
  await act(async () => { oldQueue.resolve(ok([])); });
  expect(screen.getByRole("button", { name: "Đang tải" })).toBeDisabled();
  await act(async () => {
    nextRead.resolve(ok([]));
    nextTables.resolve({ data: { ok: false, error: "actor_not_allowed" }, error: null });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("actor_not_allowed");
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("shows a retryable read error and ends loading when a hand query rejects", async () => {
  backend.from.mockImplementation(() => query(async () => { throw new Error("network unavailable"); }));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText(/Không tải được lịch sử hand: network unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  expect(screen.queryByText("Chưa có hand nào được ghi")).not.toBeInTheDocument();
});

it("keeps hand data but marks queue status unavailable when the queue read rejects", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1"
    ? new Promise(() => {}) : Promise.reject(new Error("queue unavailable")));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
  expect(screen.getByText("#1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled();
});

it.each([null, {}, [null], [{ hand_id: "hand-a", queue_status: "unknown-status" }], [{ queue_status: "pending" }],
  [{ hand_id: "hand-a", queue_status: "pending" }, { hand_id: "hand-a", queue_status: "stale" }]])(
  "marks malformed queue payload unavailable rather than silently empty: %j", async (payload) => {
    backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1"
      ? new Promise(() => {}) : Promise.resolve({ data: payload, error: null }));
    render(<HandHistoryWorkspace tournamentId="tour-a" />);
    expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.queryByText("Đang xác minh", { selector: "span" })).not.toBeInTheDocument();
  });

it("keeps a successful empty queue distinct from an unavailable queue", async () => {
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled());
  expect(screen.queryByText("Không tải được trạng thái hàng đợi xác minh.")).not.toBeInTheDocument();
});

it("renders a valid pending queue row without calling it unavailable", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? new Promise(() => {})
    : Promise.resolve(ok([{ hand_id: "hand-a", queue_status: "pending" }])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Đang xác minh", { selector: "span" })).toBeInTheDocument();
  expect(screen.queryByText("Không tải được trạng thái hàng đợi xác minh.")).not.toBeInTheDocument();
});

it("does not display partial queue data returned alongside an RPC error", async () => {
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? new Promise(() => {})
    : Promise.resolve({ data: [{ hand_id: "hand-a", queue_status: "pending" }], error: { message: "503 unavailable" } }));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByText("Không tải được trạng thái hàng đợi xác minh.")).toBeInTheDocument();
  expect(screen.getByText("#1")).toBeInTheDocument();
  expect(screen.queryByText("Đang xác minh", { selector: "span" })).not.toBeInTheDocument();
});

it("does not let an old queue response clear the new tournament hand selection", async () => {
  const oldQueue = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "list_tracker_history_tables_v1"
    ? new Promise(() => {}) : args.p_tournament_id === "tour-a" ? oldQueue.promise : Promise.resolve(ok([])));
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" workspaceMode initialHandId="hand-a" /></MemoryRouter>);
  await screen.findByText("#1");
  backend.from.mockImplementation((table: string) => query(async () => ok(table === "tournament_hands" ? [hand("hand-b", 2)] : [])));
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-b" workspaceMode initialHandId="hand-b" /></MemoryRouter>);
  await screen.findByText("#2");
  expect(screen.getByRole("button", { name: "Chọn hand khác" })).toBeInTheDocument();
  await act(async () => { oldQueue.resolve(ok([])); });
  expect(screen.getByRole("button", { name: "Chọn hand khác" })).toBeInTheDocument();
});

it("removes the previous tournament archive while the next scope is still loading", async () => {
  const nextRead = deferred<ReturnType<typeof ok>>();
  const view = render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" /></MemoryRouter>);
  await screen.findByText("#1");
  backend.from.mockImplementation((table: string) => query(() => table === "tournament_hands" ? nextRead.promise : Promise.resolve(ok([]))));
  view.rerender(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-b" /></MemoryRouter>);
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Đang tải" })).toBeDisabled();
  await act(async () => { nextRead.resolve(ok([hand("hand-b", 2)])); });
  expect(await screen.findByText("#2")).toBeInTheDocument();
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
});

it("removes the previous table archive while a new table read is pending", async () => {
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_history_tables_v1"
    ? { data: { ok: true, tables: [{ tournament_table_id: "table-a", physical_table_id:'physical-a', table_name: "Table A" }, { tournament_table_id: "table-b", physical_table_id:'physical-b', table_name: "Table B" }] }, error: null }
    : ok([])));
  render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a" initialTableId="table-a" /></MemoryRouter>);
  await screen.findByText("#1");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  const nextRead = deferred<ReturnType<typeof ok>>();
  backend.from.mockImplementation((table: string) => query(() => table === "tournament_hands" ? nextRead.promise : Promise.resolve(ok([]))));
  fireEvent.change(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" }), { target: { value: "table-b" } });
  expect(screen.queryByText("#1")).not.toBeInTheDocument();
  await act(async () => { nextRead.resolve(ok([hand("hand-b", 2)])); });
  expect(await screen.findByText("#2")).toBeInTheDocument();
});

it("shows table authority errors and lets an explicit retry recover the filter", async () => {
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_history_tables_v1"
    ? { data: { ok: false, error: "actor_not_allowed" }, error: null } : ok([])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách bàn: actor_not_allowed");
  expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeDisabled();
  expect(backend.rpc.mock.calls.some(([name]) => name === "get_tournament_tables")).toBe(false);
  backend.rpc.mockImplementation((name: string) => Promise.resolve(name === "list_tracker_history_tables_v1"
    ? { data: { ok: true, tables: [{ tournament_table_id: "table-a", physical_table_id:'physical-a', table_name: "Table A" }] }, error: null } : ok([])));
  fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách bàn" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Lọc lịch sử theo bàn" })).toBeEnabled());
  expect(screen.getByRole("option", { name: "Table A" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ends a never-settling hand read and ignores its late completion", async () => {
  vi.useFakeTimers();
  const read = deferred<ReturnType<typeof ok>>();
  backend.rpc.mockResolvedValue({ data: { ok: true, tables: [] }, error: null });
  backend.from.mockImplementation(() => query(() => read.promise));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByText(/Hết thời gian tải lịch sử hand/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  await act(async () => { read.resolve(ok([hand("late", 999)])); });
  expect(screen.queryByText("#999")).not.toBeInTheDocument();
  expect(screen.getByText(/Hết thời gian tải lịch sử hand/)).toBeInTheDocument();
});

it("ends a never-settling table read and ignores its late inventory", async () => {
  vi.useFakeTimers();
  const read = deferred<unknown>();
  backend.rpc.mockImplementation((name: string) => name === "list_tracker_history_tables_v1" ? read.promise : Promise.resolve(ok([])));
  render(<HandHistoryWorkspace tournamentId="tour-a" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Hết thời gian tải danh sách bàn");
  expect(screen.getByRole("button", { name: "Tải lại danh sách bàn" })).toBeEnabled();
  await act(async () => { read.resolve({ data: { ok: true, tables: [{ tournament_table_id: "late", physical_table_id:'physical-late', table_name: "Late table" }] }, error: null }); });
  expect(screen.queryByRole("option", { name: "Late table" })).not.toBeInTheDocument();
});
it.each(['tournament_hands','hand_players','hand_actions'])('rejects null %s pages and recovers explicitly',async(failedTable)=>{
 let fail=true;
 backend.from.mockImplementation((table:string)=>query(async()=>table===failedTable&&fail?{data:null,error:null}:ok(table==='tournament_hands'?[hand('hand-a',1)]:[])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a"/></MemoryRouter>);
 expect(await screen.findByText(/Dữ liệu trang lịch sử không hợp lệ/)).toBeInTheDocument();expect(screen.queryByText('#1')).not.toBeInTheDocument();
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Thử lại',exact:true}));expect(await screen.findByText('#1')).toBeInTheDocument();expect(screen.queryByText(/Dữ liệu trang lịch sử không hợp lệ/)).not.toBeInTheDocument();
});
it('rejects a null later hand page instead of publishing its first 1000 rows',async()=>{
 let page=0;backend.from.mockImplementation((table:string)=>query(async()=>table==='tournament_hands'?(++page===1?ok(Array.from({length:1000},(_,i)=>hand('hand-'+i,i+1))):{data:null,error:null}):ok([])));
 render(<MemoryRouter><HandHistoryWorkspace tournamentId="tour-a"/></MemoryRouter>);
 expect(await screen.findByText(/Dữ liệu trang lịch sử không hợp lệ/)).toBeInTheDocument();expect(page).toBe(2);expect(screen.queryByText('#1')).not.toBeInTheDocument();
});
