import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ actor: "owner", club: "A", loading: false,
  session: { access_token: "LOCAL_SESSION_A" },
  error: null as string | null, refreshScope: vi.fn(), load: vi.fn(), client: {} }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({
  user: h.actor ? { id: h.actor } : null, session: h.actor ? h.session : null, loading: false,
}) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => h.client }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => ({ selectedClubId: h.club }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({
  loading: h.loading, scopeError: h.error, isSuperAdmin: false,
  moduleClubIds: () => ["A", "B"], clubs: [], refresh: h.refreshScope,
}) }));
vi.mock("./dealerControlReadAdapter", () => ({ loadDealerControlReadModel: (...args: unknown[]) => h.load(...args) }));
import OpsDealerControlWorkspace from "./OpsDealerControlWorkspace";

const model = (name: string) => ({ tables: [{ id: name, name, tableType: "tournament", status: "open",
  dealerName: null, dealerTier: null, swingDueAt: null, needsReplacement: false }],
checkedIn: 1, available: 1, assigned: 0, onBreak: 0, loadedAt: "2026-10-20T00:00:00Z" });

beforeEach(() => {
  h.actor = "owner"; h.club = "A"; h.loading = false; h.error = null;
  h.session = { access_token: "LOCAL_SESSION_A" };
  h.load.mockReset();
  h.refreshScope.mockReset();
});
afterEach(() => vi.useRealTimers());

it("retries failed capabilities rather than a permanently disabled inventory read", () => {
  h.error = "Scope read unavailable";
  render(<OpsDealerControlWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Làm mới Dealer Swing" }));
  expect(h.refreshScope).toHaveBeenCalledTimes(1);
  expect(h.load).not.toHaveBeenCalled();
});

it("does not label the previous club snapshot as the newly selected club", async () => {
  h.load.mockImplementation((_client, club) => club === "A" ? Promise.resolve(model("A table")) : new Promise(() => {}));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("A table");
  h.club = "B";
  view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.queryByText("A table")).toBeNull();
  expect(screen.getByText("Đang tải snapshot Dealer Swing…")).toBeTruthy();
});

it("retires loaded private rows at logout", async () => {
  h.load.mockResolvedValue(model("private table"));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("private table");
  h.actor = "";
  view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.queryByText("private table")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("retires the snapshot while capabilities are being reverified", async () => {
  h.load.mockResolvedValue(model("old table"));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("old table");
  h.loading = true;
  view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.queryByText("old table")).toBeNull();
});

it("ignores an old read after A -> B -> A", async () => {
  const resolve: ((value: ReturnType<typeof model>) => void)[] = [];
  h.load.mockImplementation(() => new Promise((done) => resolve.push(done)));
  const view = render(<OpsDealerControlWorkspace />);
  h.club = "B"; view.rerender(<OpsDealerControlWorkspace />);
  h.club = "A"; view.rerender(<OpsDealerControlWorkspace />);
  await act(async () => resolve[2](model("fresh A")));
  await act(async () => { resolve[0](model("old A")); resolve[1](model("old B")); });
  expect(screen.getByText("fresh A")).toBeTruthy();
  expect(screen.queryByText("old A")).toBeNull();
  expect(screen.queryByText("old B")).toBeNull();
});

it("reloads after capability recovery without reviving the retired read", async () => {
  const resolve: ((value: ReturnType<typeof model>) => void)[] = [];
  h.load.mockImplementation(() => new Promise((done) => resolve.push(done)));
  const view = render(<OpsDealerControlWorkspace />);
  h.loading = true; view.rerender(<OpsDealerControlWorkspace />);
  h.loading = false; view.rerender(<OpsDealerControlWorkspace />);
  await act(async () => resolve[0](model("retired table")));
  expect(screen.queryByText("retired table")).toBeNull();
  await act(async () => resolve[1](model("verified table")));
  expect(screen.getByText("verified table")).toBeTruthy();
});

it("clears the previous actor snapshot before the new actor read completes", async () => {
  h.load.mockResolvedValueOnce(model("owner table")).mockImplementation(() => new Promise(() => {}));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("owner table");
  h.actor = "another-operator"; view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.queryByText("owner table")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(2);
});

it("retires the snapshot when the same actor receives a replacement verified session", async () => {
  h.load.mockResolvedValueOnce(model("old session table")).mockImplementation(() => new Promise(() => {}));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("old session table");
  h.session = { access_token: "LOCAL_SESSION_B" };
  view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.queryByText("old session table")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(2);
});

it("does not accept an in-flight read from a retired same-actor session", async () => {
  const resolve: ((value: ReturnType<typeof model>) => void)[] = [];
  h.load.mockImplementation(() => new Promise((done) => resolve.push(done)));
  const view = render(<OpsDealerControlWorkspace />);
  h.session = { access_token: "LOCAL_SESSION_B" };
  view.rerender(<OpsDealerControlWorkspace />);
  await act(async () => resolve[0](model("retired session table")));
  expect(screen.queryByText("retired session table")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(2);
  await act(async () => resolve[1](model("current session table")));
  expect(screen.getByText("current session table")).toBeTruthy();
});

it("preserves the verified snapshot on a stable-session rerender", async () => {
  h.load.mockResolvedValue(model("stable session table"));
  const view = render(<OpsDealerControlWorkspace />);
  await screen.findByText("stable session table");
  view.rerender(<OpsDealerControlWorkspace />);
  expect(screen.getByText("stable session table")).toBeTruthy();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("ends a hung read with an explicit error and ignores its late result", async () => {
  vi.useFakeTimers();
  let resolve!: (value: ReturnType<typeof model>) => void;
  h.load.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<OpsDealerControlWorkspace />);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(screen.getByText("DEALER_CONTROL_READ_TIMEOUT")).toBeTruthy();
  expect((h.load.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Làm mới Dealer Swing" })).not.toBeDisabled();
  await act(async () => resolve(model("late table")));
  expect(screen.queryByText("late table")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("allows an explicit fresh read after timeout without accepting the timed-out read", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: ReturnType<typeof model>) => void;
  h.load.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }))
    .mockResolvedValueOnce(model("recovered table"));
  render(<OpsDealerControlWorkspace />);
  await act(async () => vi.advanceTimersByTime(10000));
  fireEvent.click(screen.getByRole("button", { name: "Làm mới Dealer Swing" }));
  await act(async () => {});
  expect(screen.getByText("recovered table")).toBeTruthy();
  await act(async () => resolveOld(model("expired table")));
  expect(screen.queryByText("expired table")).toBeNull();
  expect(screen.getByText("recovered table")).toBeTruthy();
  expect(h.load).toHaveBeenCalledTimes(2);
});

it("does not expose raw backend error text or convert it to an empty snapshot", async () => {
  h.load.mockRejectedValue(new Error("private response body"));
  render(<OpsDealerControlWorkspace />);
  await screen.findByText("DEALER_CONTROL_READ_FAILED");
  expect(screen.queryByText("private response body")).toBeNull();
  expect(screen.queryByText("Không có bàn đang hoạt động.")).toBeNull();
});

it("makes repair-required rows explicit in the real view", async () => {
  const value = model("repair table");
  value.tables[0].status = "repair_required";
  h.load.mockResolvedValue(value);
  render(<OpsDealerControlWorkspace />);
  await screen.findByText("Cần sửa dữ liệu");
  expect(screen.getByText("repair table")).toBeTruthy();
});

it("keeps open tables ahead of legacy repair rows and separates table counts from dealer counts", async () => {
  const value = model("legacy table");
  value.tables[0].status = "preflight_required";
  value.tables.push({ ...value.tables[0], id: "open", name: "open table", status: "in_use" });
  h.load.mockResolvedValue(value);
  render(<OpsDealerControlWorkspace />);
  await screen.findByText("open table");
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("open table");
  expect(screen.getByText("Bàn đang mở: 1 · Bàn sẵn sàng: 0 · Cần sửa dữ liệu: 1")).toBeTruthy();
});
it('shows the completed read time and replaces it only after a fresh model arrives',async()=>{
 h.load.mockResolvedValueOnce(model('A table'));const view=render(<OpsDealerControlWorkspace/>);await act(async()=>{});
 expect(view.container.querySelector('time')).toHaveAttribute('datetime','2026-10-20T00:00:00Z');
 let finish!:(value:ReturnType<typeof model>)=>void;h.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'Làm mới Dealer Swing'}));expect(view.container.querySelector('time')).toBeNull();
 await act(async()=>finish({...model('A table'),loadedAt:'2026-10-27T00:00:00Z'}));expect(view.container.querySelector('time')).toHaveAttribute('datetime','2026-10-27T00:00:00Z');
 expect(view.container.querySelector('article')).toHaveAttribute('data-ops-table-id','A table');
 h.load.mockRejectedValueOnce(new Error('DEALER_CONTROL_READ_FAILED'));fireEvent.click(screen.getByRole('button',{name:'Làm mới Dealer Swing'}));await act(async()=>{});expect(view.container.querySelector('time')).toBeNull();
});
