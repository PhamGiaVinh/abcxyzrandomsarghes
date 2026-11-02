import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";
const state = vi.hoisted(() => ({ user: { id: "owner" }, read: vi.fn(),
  t: (key: string) => key,
  rpc: vi.fn(), from: vi.fn(), inventory: vi.fn(), invoke: vi.fn(), toastError: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: true, floorRedrawSeatLockV1: true } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from, functions: { invoke: state.invoke } } }));
vi.mock("sonner", () => ({ toast: { error: state.toastError, success: vi.fn() } }));
vi.mock("./PlayerActionSheet", () => ({ PlayerActionSheet: ({ open, editDisabledReason, onBust }: { open: boolean; editDisabledReason?: string; onBust: () => void }) => open
  ? <><button disabled={!!editDisabledReason}>Sửa chip{editDisabledReason ? `: ${editDisabledReason}` : ""}</button><button onClick={onBust}>Loại TEST</button></> : null }));
vi.mock("./MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
vi.mock("./EditChipsDialog", () => ({ EditChipsDialog: () => null }));
vi.mock("./PlayerInfoSheet", () => ({ PlayerInfoSheet: () => null }));
vi.mock("./ManualFloorBustConfirmDialog", () => ({ ManualFloorBustConfirmDialog: () => null }));
vi.mock("./RestoreBustDialog", () => ({ RestoreBustDialog: () => null }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
import { PlayersGroupedPanel } from "./PlayersGroupedPanel";

const tour = (id: string) => ({ id, club_id: "club", name: "TEST" }) as Tournament;
const table = (overrides: Record<string, unknown> = {}) => ({ tournament_table_id: "table", game_table_id: "physical",
  table_session_id: "current", control_mode: "manual", control_epoch: 2, revision: 9,
  table_number: 3, table_name: "TEST 1", operational_status: "available",
  availability_status: "current_tournament", max_seats: 9, ...overrides });
const projection = (id: string) => ({ tournament_id: id, entries: [], seats: [
  { seat_id: "valid", entry_id: "entry1", player_id: "player1", player_name: `Current ${id}`, entry_number: 1,
    table_id: "table", tournament_table_id: "table", table_session_id: "current", table_name: "TEST 1",
    seat_number: 1, chip_count: 20000, is_active: true, participation_status: "seated", anomaly_reason: null },
  { seat_id: "invalid", entry_id: "entry2", player_id: "player2", player_name: `Legacy ${id}`, entry_number: 1,
    table_id: "old", tournament_table_id: "old", table_session_id: "closed", table_name: "TEST old",
    seat_number: 2, chip_count: 20000, is_active: true, participation_status: "anomaly", anomaly_reason: "closed_session" },
], counts: { total_entries: 2, re_entries: 0, remaining: 2, seated: 1, waiting: 0, busted: 0,
  anomaly_entries: 1, anomaly_seats: 1, live_entry_stack: 40000, seated_stack: 20000, waiting_stack: 0 } });
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "owner" };
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "get_my_floor_operator_scope"
    ? Promise.resolve({ data: [{ club_id: "club", can_owner: true }], error: null })
    : name === "get_floor_tournament_table_inventory_v1" ? state.inventory(args.p_tournament_id) : state.read(args.p_tournament_id));
  state.inventory.mockResolvedValue({ data: [table()], error: null });
  state.read.mockImplementation((id: string) => Promise.resolve({ data: projection(id), error: null }));
  state.from.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [{ id: "table", table_id: "physical", floor_control_mode: "manual" }], error: null }) }) });
});
afterEach(cleanup);
describe("participation operator panel", () => {
  it.each(["live", "completed", "finished", "cancelled"])("limits busted-player restore to an active tour: %s", async status => {
    state.read.mockResolvedValue({ data: { ...projection("a"), entries: [{
      id: "busted-entry", player_id: "busted-player", player_name: "Busted TEST", entry_no: 1,
      current_stack: 0, seat_number: null, finished_place: 2, status: "busted",
      participation_status: "busted", anomaly_reason: null,
    }] }, error: null });
    render(<PlayersGroupedPanel tournament={{ ...tour("a"), status } as Tournament} refreshTrigger={0} />);
    await screen.findByText("Current a");
    fireEvent.click(screen.getByRole("button", { name: /^Bust/ }));
    expect(screen.getByText("Busted TEST")).toBeInTheDocument();
    if (status === "live") expect(screen.getByRole("button", { name: "Hoàn tác bust nhầm" })).toBeInTheDocument();
    else expect(screen.queryByRole("button", { name: "Hoàn tác bust nhầm" })).toBeNull();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it.each(["completed", "finished", "cancelled"])("keeps %s player rows readable without mutation actions", async status => {
    render(<PlayersGroupedPanel tournament={{ ...tour("a"), status } as Tournament} refreshTrigger={0} />);
    expect((await screen.findByText("Current a")).closest("button")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Sửa chip|Loại TEST|Hoàn tác bust nhầm/ })).toBeNull();
    expect(state.inventory).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("retires an open player action sheet immediately when the same tour completes", async () => {
    const view = render(<PlayersGroupedPanel tournament={{ ...tour("a"), status: "live" }} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: "Loại TEST" })).toBeInTheDocument();
    view.rerender(<PlayersGroupedPanel tournament={{ ...tour("a"), status: "completed" }} refreshTrigger={0} />);
    expect(screen.queryByRole("button", { name: "Loại TEST" })).toBeNull();
    expect((await screen.findByText("Current a")).closest("button")).toBeDisabled();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("discards a bust preflight delivered after the tour completes", async () => {
    const view = render(<PlayersGroupedPanel tournament={{ ...tour("a"), status: "live" }} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    let finish!: (value: unknown) => void;
    state.inventory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Loại TEST" }));
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(<PlayersGroupedPanel tournament={{ ...tour("a"), status: "completed" }} refreshTrigger={0} />);
    await act(async () => finish({ data: [table({ control_mode: "tracker" })], error: null }));
    expect(state.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Loại TEST" })).toBeNull();
  });
  it.each(["42501", "PGRST301", "PGRST302", "PGRST303"])("clears previously readable rows for primary access error %s", async (code) => {
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    state.read.mockResolvedValue({ data: null, error: { message: "Permission denied", code } });
    view.rerender(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={1} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Current a")).toBeNull();
  });
  it("preserves same-scope last-good rows as stale on transient primary read failure", async () => {
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    state.read.mockResolvedValue({ data: null, error: { message: "503", code: "PGRST002" } });
    view.rerender(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("participation.stale");
    expect(screen.getByText("Current a").closest("button")).toBeDisabled();
  });
  it("keeps authorized rows while rejecting malformed inventory as action authority", async () => {
    state.inventory.mockResolvedValue({ data: [{ bad: true }], error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect((await screen.findByText("Current a")).closest("button")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("thao tác tạm khóa");
  });
  it("keeps viewer data without granting Floor authority when inventory is denied", async () => {
    state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "get_my_floor_operator_scope"
      ? Promise.resolve({ data: [], error: null }) : name === "get_floor_tournament_table_inventory_v1"
        ? state.inventory(args.p_tournament_id) : state.read(args.p_tournament_id));
    state.inventory.mockResolvedValue({ data: null, error: { message: "Permission denied", code: "42501" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect((await screen.findByText("Current a")).closest("button")).toBeDisabled();
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it("refreshes readable participation while invalidating previously valid table authority", async () => {
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect((await screen.findByText("Current a")).closest("button")).toBeEnabled();
    state.inventory.mockResolvedValue({ data: null, error: { message: "503" } });
    state.read.mockResolvedValue({ data: { ...projection("a"), seats: projection("a").seats.map(s => ({ ...s, chip_count: 19000 })) }, error: null });
    view.rerender(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={1} />);
    await screen.findByRole("alert");
    expect((screen.getByText("Current a")).closest("button")).toBeDisabled();
    expect(screen.getByText("19.000")).toBeInTheDocument();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("never displays successful inventory as participation when the primary read is denied", async () => {
    state.read.mockResolvedValue({ data: null, error: { message: "42501", code: "42501" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("participation.loadError");
    expect(screen.queryByText("Current a")).toBeNull();
  });
  it("does not reuse rows or authority for a different account with a failed read", async () => {
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    state.user = { id: "other" };
    state.read.mockResolvedValue({ data: null, error: { message: "503" } });
    view.rerender(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={1} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Current a")).toBeNull();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("does not reuse rows for a changed club even when tournament ID is unchanged", async () => {
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    state.read.mockResolvedValue({ data: null, error: { message: "503" } });
    view.rerender(<PlayersGroupedPanel tournament={{ ...tour("a"), club_id: "other-club" }} refreshTrigger={1} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Current a")).toBeNull();
  });
  it.each(["503", "42501"])("keeps successful participation readable but disables actions when inventory returns %s", async (message) => {
    state.inventory.mockResolvedValue({ data: null, error: { message } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    const row = (await screen.findByText("Current a")).closest("button")!;
    expect(row).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh được trạng thái bàn");
    expect(screen.getByRole("button", { name: /Đang chơi 1/ })).toBeInTheDocument();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("rechecks canonical mode before bust rather than trusting displayed Manual", async () => {
    state.inventory.mockResolvedValueOnce({ data: [table()], error: null })
      .mockResolvedValueOnce({ data: [table({ control_mode: "tracker", control_epoch: 3 })], error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: "Sửa chip" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Loại TEST" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0."));
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it("does not bust after the table has reopened with a different session", async () => {
    state.inventory.mockResolvedValueOnce({ data: [table()], error: null })
      .mockResolvedValueOnce({ data: [table({ table_session_id: "reopened" })], error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Loại TEST" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại."));
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("allows the existing Manual chip action only for the exact current session", async () => {
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: "Sửa chip" })).toBeEnabled();
    expect(state.from).not.toHaveBeenCalled();
  });
  it.each([
    ["missing", []],
    ["reopened session", [table({ table_session_id: "next-session" })]],
    ["different logical table", [table({ tournament_table_id: "other" })]],
    ["repair required", [table({ availability_status: "repair_required" })]],
  ])("blocks chip editing when canonical context is %s", async (_label, rows) => {
    state.inventory.mockResolvedValue({ data: rows, error: null });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toHaveTextContent("Không xác minh được chế độ bàn.");
  });
  it("does not turn an inventory read failure into Manual authority", async () => {
    state.inventory.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không xác minh được trạng thái bàn");
    expect(screen.queryByRole("button", { name: /Sửa chip/ })).toBeNull();
  });
  it("does not permit chip editing from legacy Manual when the exact session is Tracker", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => name === "get_floor_tournament_table_inventory_v1"
      ? Promise.resolve({ data: [{ tournament_table_id: "table", game_table_id: "physical", table_session_id: "current",
        control_mode: "tracker", control_epoch: 2, revision: 9, table_number: 3, table_name: "TEST 1",
        operational_status: "available", availability_status: "current_tournament", max_seats: 9 }], error: null }) : original(name, args));
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    fireEvent.click((await screen.findByText("Current a")).closest("button")!);
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Sửa chip/ })).toHaveTextContent("Bàn Live Tracker do Tracker quản lý chip.");
  });
  it("does not offer anomaly player actions but keeps the row visible in repair group", async () => {
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await screen.findByText("Current a");
    expect(screen.queryByText("Legacy a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /participation.repairRequired/ }));
    expect(screen.getByText(/Legacy a/).closest("button")).toBeNull();
    expect(screen.getByText(/participation.reasons.closed_session/)).toBeInTheDocument();
  });
  it("shows read failure explicitly instead of zero or an endless skeleton", async () => {
    state.read.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("participation.loadError");
    expect(screen.queryByText("Chưa có người chơi đang hoạt động.")).toBeNull();
  });
  it("discards delayed previous-tournament response", async () => {
    let resolveA!: (value: unknown) => void;
    state.read.mockImplementation((id: string) => id === "a" ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ data: projection(id), error: null }));
    const view = render(<PlayersGroupedPanel tournament={tour("a")} refreshTrigger={0} />);
    await waitFor(() => expect(state.read).toHaveBeenCalledWith("a"));
    view.rerender(<PlayersGroupedPanel tournament={tour("b")} refreshTrigger={0} />);
    await screen.findByText("Current b");
    resolveA({ data: projection("a"), error: null });
    await waitFor(() => expect(screen.queryByText("Current a")).toBeNull());
    expect(screen.getByText("Current b")).toBeInTheDocument();
  });
});

it('keeps current participants visible while bagged qualifiers are excluded from waiting actions',async()=>{
 const p={...projection('a'),entries:[{id:'bagged-entry',player_id:'bagged-player',player_name:'Bagged qualifier TEST',entry_no:1,current_stack:20000,seat_number:null,finished_place:null,status:'bagged',participation_status:'bagged',anomaly_reason:null}]};
 state.read.mockResolvedValue({data:p,error:null});render(<PlayersGroupedPanel tournament={tour('a')} refreshTrigger={0}/>);
 expect(await screen.findByText('Current a')).toBeInTheDocument();
 expect(screen.queryByText('Bagged qualifier TEST')).toBeNull();
 expect(state.rpc.mock.calls.some(([name])=>name==='floor_manual_bust_v1')).toBe(false);
});

it('excludes legacy bagged-as-waiting rows while retaining genuinely registered waiting entries',async()=>{
 const entry={id:'bagged-entry',player_id:'bagged-player',player_name:'Legacy bagged qualifier TEST',entry_no:1,current_stack:20000,seat_number:null,finished_place:null,status:'bagged',participation_status:'waiting',anomaly_reason:null};
 const p={...projection('a'),entries:[entry,{...entry,id:'waiting-entry',player_id:'waiting-player',player_name:'Genuine waiting TEST',status:'registered'}]};
 state.read.mockResolvedValue({data:p,error:null});render(<PlayersGroupedPanel tournament={tour('a')} refreshTrigger={0}/>);
 await screen.findByText('Current a');fireEvent.click(screen.getByRole('button',{name:/Chờ xếp.*1/}));
 expect(screen.getByText('Genuine waiting TEST')).toBeInTheDocument();expect(screen.queryByText('Legacy bagged qualifier TEST')).toBeNull();
 expect(state.invoke).not.toHaveBeenCalled();
});

it.each(['bagged','waiting'] as const)('shows a read-only bagged group for canonical and legacy projections: %s',async(classification)=>{
 const p={...projection('a'),entries:[{id:'bagged-entry',player_id:'bagged-player',player_name:'Retained qualifier TEST',entry_no:1,current_stack:20000,seat_number:null,finished_place:null,status:'bagged',participation_status:classification,anomaly_reason:null}]};
 state.read.mockResolvedValue({data:p,error:null});render(<PlayersGroupedPanel tournament={tour('a')} refreshTrigger={0}/>);
 await screen.findByText('Current a');fireEvent.click(screen.getByRole('button',{name:/participation.bagged.*1/}));
 const region=screen.getByRole('region',{name:'participation.bagged'});expect(region).toHaveTextContent('Retained qualifier TEST');
 expect(region).toHaveTextContent('20.000');expect(region).toHaveTextContent('participation.baggedHint');
 expect(region.querySelector('button,input')).toBeNull();expect(state.invoke).not.toHaveBeenCalled();
});
