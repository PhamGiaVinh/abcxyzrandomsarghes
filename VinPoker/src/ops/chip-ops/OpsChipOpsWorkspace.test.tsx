import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ actor: "actor", club: "A", allowed: true, scopeLoading: false,
  scopeError: null as string | null, refreshScope: vi.fn(), tournament: "flight", load: vi.fn(), inventory: vi.fn(), client: {} }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: h.actor ? { id: h.actor } : null, loading: false }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => h.client }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => ({ selectedClubId: h.club }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({
  loading: h.scopeLoading, scopeError: h.scopeError, isSuperAdmin: false,
  moduleClubIds: () => h.allowed ? ["A", "B"] : [], clubs: [], refresh: h.refreshScope,
}) }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams({ t: h.tournament }), vi.fn()] }));
vi.mock("./chipOpsReadAdapter", () => ({
  loadChipOpsTournamentOptions: (...args: unknown[]) => h.load(...args),
  loadIssuedChipInventory: (...args: unknown[]) => h.inventory(...args), loadIssuedStackSummary: async () => null,
}));
vi.mock("./ChipOpsWorkspaceView", () => ({ ChipOpsWorkspaceView: (p: { tournaments: { name: string }[]; inventory: unknown; loading: boolean; errorCode: string | null; onRefresh: () => void }) =>
  <div><div>{p.tournaments.map((t) => t.name).join(",")}</div><div>{JSON.stringify(p.inventory)}</div>
    <div>{p.errorCode}</div><button disabled={p.loading} onClick={p.onRefresh}>Refresh chip</button></div> }));
vi.mock("./MultiDayBaggingPanel", () => ({ MultiDayBaggingPanel: () => <div>bagging-actions</div> }));
import OpsChipOpsWorkspace from "./OpsChipOpsWorkspace";

beforeEach(() => {
  h.actor = "actor"; h.club = "A"; h.allowed = true; h.scopeLoading = false; h.scopeError = null;
  h.tournament = "flight"; h.load.mockReset(); h.inventory.mockReset(); h.inventory.mockResolvedValue(null);
  h.refreshScope.mockReset();
});
afterEach(() => vi.useRealTimers());

it("refreshes failed capability scope without loading inventory or mounting bagging", () => {
  h.scopeError = "Scope read unavailable";
  render(<OpsChipOpsWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh chip" }));
  expect(h.refreshScope).toHaveBeenCalledTimes(1);
  expect(h.load).not.toHaveBeenCalled();
  expect(h.inventory).not.toHaveBeenCalled();
  expect(screen.queryByText("bagging-actions")).toBeNull();
});

it("does not replace club B results with a late club A response", async () => {
  let resolveA!: (value: unknown) => void;
  h.load.mockImplementation((_client, club) => club === "A"
    ? new Promise((resolve) => { resolveA = resolve; })
    : Promise.resolve([{ id: "flight", name: "B tour", phase: "flight" }]));
  const view = render(<OpsChipOpsWorkspace />);
  await waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
  h.club = "B";
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText("B tour");
  await act(async () => resolveA([{ id: "flight", name: "A tour", phase: "flight" }]));
  expect(screen.queryByText("A tour")).toBeNull();
  expect(screen.getByText("B tour")).toBeTruthy();
});

it("removes bagging actions immediately when chip scope is lost", async () => {
  h.load.mockResolvedValue([{ id: "flight", name: "A tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.allowed = false;
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(screen.queryByText("A tour")).toBeNull();
});

it("does not revive an old A lifetime after A -> B -> A", async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  h.load.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const view = render(<OpsChipOpsWorkspace />);
  h.club = "B";
  view.rerender(<OpsChipOpsWorkspace />);
  h.club = "A";
  view.rerender(<OpsChipOpsWorkspace />);
  await act(async () => resolvers[2]([{ id: "flight", name: "fresh A", phase: "flight" }]));
  await act(async () => {
    resolvers[0]([{ id: "flight", name: "old A", phase: "flight" }]);
    resolvers[1]([{ id: "flight", name: "old B", phase: "flight" }]);
  });
  expect(screen.getByText("fresh A")).toBeTruthy();
  expect(screen.queryByText("old A")).toBeNull();
  expect(screen.queryByText("old B")).toBeNull();
});

it("clears the old actor's loaded actions and options at logout", async () => {
  h.load.mockResolvedValue([{ id: "flight", name: "private tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.actor = "";
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("private tour")).toBeNull();
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("ignores delayed inventory from the previous tournament", async () => {
  let resolveOld!: (value: unknown) => void;
  h.load.mockResolvedValue([
    { id: "flight", name: "first", phase: "flight" },
    { id: "next", name: "second", phase: "flight" },
  ]);
  h.inventory.mockImplementation((_client, tournament) => tournament === "flight"
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve("new inventory"));
  const view = render(<OpsChipOpsWorkspace />);
  await waitFor(() => expect(h.inventory).toHaveBeenCalledTimes(1));
  h.tournament = "next";
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText('"new inventory"');
  await act(async () => resolveOld("old inventory"));
  expect(screen.queryByText('"old inventory"')).toBeNull();
  expect(screen.getByText('"new inventory"')).toBeTruthy();
});

it.each(["loading", "error"])("removes actions on scope %s and reloads on recovery", async (reason) => {
  h.load.mockResolvedValue([{ id: "flight", name: "private tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.scopeLoading = reason === "loading";
  h.scopeError = reason === "error" ? "READ_FAILED" : null;
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(screen.queryByText("private tour")).toBeNull();
  h.scopeLoading = false;
  h.scopeError = null;
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  expect(h.load).toHaveBeenCalledTimes(2);
});

it("times out a hung tournament read without starting inventory or bagging writes", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: unknown) => void;
  h.load.mockImplementation(() => new Promise((done) => { resolveOld = done; }));
  render(<OpsChipOpsWorkspace />);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(screen.getByText("CHIP_OPS_READ_TIMEOUT")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh chip" })).not.toBeDisabled();
  await act(async () => resolveOld([{ id: "flight", name: "late tour", phase: "flight" }]));
  expect(screen.queryByText("late tour")).toBeNull();
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(h.inventory).not.toHaveBeenCalled();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("does not report missing club permission while capabilities are still loading", () => {
  h.scopeLoading = true; h.allowed = false;
  render(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("CHIP_OPS_CLUB_SCOPE_REQUIRED")).toBeNull();
  expect(h.load).not.toHaveBeenCalled();
});

it("can explicitly recover after an inventory timeout without accepting the expired snapshot", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: unknown) => void;
  h.load.mockResolvedValue([{ id: "flight", name: "tour", phase: "flight" }]);
  h.inventory.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }))
    .mockResolvedValueOnce("fresh inventory");
  render(<OpsChipOpsWorkspace />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(10000));
  expect(screen.getByText("CHIP_OPS_READ_TIMEOUT")).toBeTruthy();
  expect(screen.queryByText("bagging-actions")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh chip" }));
  await act(async () => {});
  expect(screen.getByText('"fresh inventory"')).toBeTruthy();
  await act(async () => resolveOld("expired inventory"));
  expect(screen.queryByText('"expired inventory"')).toBeNull();
  expect(screen.getByText('"fresh inventory"')).toBeTruthy();
});


it("aborts timed-out reads before allowing an explicit fresh read", async () => {
  vi.useFakeTimers();
  h.load.mockImplementation(() => new Promise(() => {}));
  const view = render(<OpsChipOpsWorkspace />);
  const firstSignal = h.load.mock.calls[0][2] as AbortSignal | undefined;
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(screen.getByText("CHIP_OPS_READ_TIMEOUT")).toBeTruthy();
  expect(firstSignal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Refresh chip" }));
  expect(h.load).toHaveBeenCalledTimes(2);
  const nextSignal = h.load.mock.calls[1][2] as AbortSignal;
  expect(nextSignal).not.toBe(firstSignal);
  expect(nextSignal.aborted).toBe(false);
  view.unmount();
  expect(nextSignal.aborted).toBe(true);
});
