import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: Array<{ id: string; name: string }>; error: unknown | null };
type QueryBuilder = {
  select: () => QueryBuilder;
  in: () => QueryBuilder;
  then: <TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

const state = vi.hoisted(() => ({
  userId: "tracker-a",
  rolesLoading: false,
  rolesError: null as string | null,
  clubs: [{ id: "club-a", name: "Club A" }] as Array<{ id: string; name: string }>,
  scopeRequest: null as ((userId: string) => Promise<{ data: string[] | null; error: unknown | null }>) | null,
  rpc: vi.fn(),
  floorRpc: vi.fn(),
  panelScopes: [] as string[][],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: state.userId }, loading: false, isAdmin: false,
    rolesLoading: state.rolesLoading, rolesError: state.rolesError,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_name: string, args: { _user_id: string }) => _name === "floor_club_ids"
      ? state.floorRpc(args._user_id) : state.scopeRequest
      ? state.scopeRequest(args._user_id)
      : state.rpc(args._user_id),
    from: () => {
      const query = {} as QueryBuilder;
      query.select = () => query;
      query.in = () => query;
      query.then = (onfulfilled, onrejected) => Promise.resolve({
        data: state.clubs,
        error: null,
      }).then(onfulfilled, onrejected);
      return { select: () => query };
    },
  },
}));
vi.mock("@/components/cashier/TournamentLivePanel", () => ({
  default: ({ clubIds, onSelectedTournamentChange }: { clubIds: string[]; onSelectedTournamentChange?: (id: string) => void }) => {
    state.panelScopes.push(clubIds);
    return <div data-testid="tracker-live-panel"><button onClick={() => onSelectedTournamentChange?.("tour-a")}>Select test tour</button></div>;
  },
}));

import TrackerDashboard from "./TrackerDashboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function renderTracker() {
  return render(<MemoryRouter initialEntries={["/tracker"]}><Routes>
    <Route path="/tracker" element={<TrackerDashboard />} />
  </Routes></MemoryRouter>);
}

describe("TrackerDashboard club read state", () => {
  beforeEach(() => {
    state.userId = "tracker-a";
    state.rolesLoading = false;
    state.rolesError = null;
    state.clubs = [{ id: "club-a", name: "Club A" }];
    state.scopeRequest = null;
    state.rpc.mockReset();
    state.floorRpc.mockReset();
    state.floorRpc.mockResolvedValue({ data: [], error: null });
    state.panelScopes = [];
    state.rpc.mockResolvedValue({ data: ["club-a"], error: null });
  });

  it("includes the server-verified Floor-only club without granting Tracker membership", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    state.floorRpc.mockResolvedValue({ data: ["quads"], error: null });
    state.clubs = [{ id: "quads", name: "Quads TEST" }];
    renderTracker();
    await screen.findByTestId("tracker-live-panel");
    expect(state.panelScopes.at(-1)).toEqual(["quads"]);
    expect(state.floorRpc).toHaveBeenCalledWith("tracker-a");
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
  });

  it("does not claim a complete scope when Floor read fails but Tracker read succeeds", async () => {
    state.floorRpc.mockResolvedValue({ data: null, error: { status: 403, message: "Floor scope denied" } });
    renderTracker();
    expect(await screen.findByText("Máy chủ chưa xác minh được danh sách CLB. Vui lòng thử lại.")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker-live-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
  });

  it("deduplicates Tracker and Floor read scopes", async () => {
    state.floorRpc.mockResolvedValue({ data: ["club-a", "quads"], error: null });
    state.clubs = [{ id: "club-a", name: "Club A" }, { id: "quads", name: "Quads TEST" }];
    renderTracker();
    await screen.findByTestId("tracker-live-panel");
    expect(state.panelScopes.at(-1)).toEqual(["club-a", "quads"]);
  });

  it("ignores a delayed Floor scope from the previous account", async () => {
    const oldFloor = deferred<{ data: string[]; error: null }>();
    state.userId = "floor-old";
    state.rpc.mockResolvedValue({ data: [], error: null });
    state.floorRpc.mockImplementation((id: string) => id === "floor-old"
      ? oldFloor.promise : Promise.resolve({ data: ["club-b"], error: null }));
    const view = renderTracker();
    await waitFor(() => expect(state.floorRpc).toHaveBeenCalledWith("floor-old"));
    state.userId = "floor-new";
    state.clubs = [{ id: "club-b", name: "Club B" }];
    view.rerender(<MemoryRouter initialEntries={["/tracker"]}><Routes>
      <Route path="/tracker" element={<TrackerDashboard />} />
    </Routes></MemoryRouter>);
    await screen.findByText("Club B");
    await act(async () => { oldFloor.resolve({ data: ["club-a"], error: null }); });
    expect(state.panelScopes.at(-1)).toEqual(["club-b"]);
    expect(screen.queryByText("Club A")).not.toBeInTheDocument();
  });

  it("keeps the verified club scope reference stable when selecting a tournament", async () => {
    renderTracker();
    await screen.findByTestId("tracker-live-panel");
    const scope = state.panelScopes.at(-1);
    fireEvent.click(screen.getByRole("button", { name: "Select test tour" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Lịch sử & sửa hand" })).toBeInTheDocument());
    expect(state.panelScopes.at(-1)).toBe(scope);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("replaces the memoized scope when a different account's clubs are verified", async () => {
    const view = renderTracker();
    await screen.findByTestId("tracker-live-panel");
    const previousScope = state.panelScopes.at(-1);
    state.userId = "tracker-b";
    state.clubs = [{ id: "club-b", name: "Club B" }];
    state.rpc.mockResolvedValue({ data: ["club-b"], error: null });
    view.rerender(<MemoryRouter initialEntries={["/tracker"]}><Routes>
      <Route path="/tracker" element={<TrackerDashboard />} />
    </Routes></MemoryRouter>);
    await screen.findByText("Club B");
    expect(state.panelScopes.at(-1)).toEqual(["club-b"]);
    expect(state.panelScopes.at(-1)).not.toBe(previousScope);
    expect(screen.queryByText("Club A")).not.toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it("turns a thrown fetch failure into a retryable error instead of an endless skeleton or empty permission", async () => {
    state.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    renderTracker();

    expect(await screen.findByText("Không kết nối được máy chủ. Kiểm tra mạng rồi thử tải lại.")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledTimes(3);

    state.rpc.mockResolvedValue({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Bạn chưa được phân công CLB nào")).toBeInTheDocument();
  });

  it("does not let an earlier user's scope response replace the active user's clubs", async () => {
    const oldScope = deferred<{ data: string[]; error: null }>();
    state.userId = "tracker-old";
    state.clubs = [{ id: "club-b", name: "Club B" }];
    state.scopeRequest = (userId) => userId === "tracker-old"
      ? oldScope.promise
      : Promise.resolve({ data: ["club-b"], error: null });
    const view = renderTracker();

    state.userId = "tracker-new";
    view.rerender(<MemoryRouter initialEntries={["/tracker"]}><Routes>
      <Route path="/tracker" element={<TrackerDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Club B")).toBeInTheDocument();
    await act(async () => { oldScope.resolve({ data: ["club-a"], error: null }); });
    expect(screen.queryByText("Club A")).not.toBeInTheDocument();
  });

  it("does not present a partial club catalog as a verified scope", async () => {
    state.rpc.mockResolvedValue({ data: ["club-a", "club-missing"], error: null });
    renderTracker();

    expect(await screen.findByText("Quyền CLB đã được xác nhận nhưng thông tin CLB không khớp. Cần kiểm tra dữ liệu.")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker-live-panel")).not.toBeInTheDocument();
  });

  it("does not declare missing permission while auth roles are loading or failed", async () => {
    state.rolesLoading = true;
    state.rpc.mockResolvedValue({ data: [], error: null });
    const view = renderTracker();
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
    state.rolesLoading = false;
    state.rolesError = "Không tải được quyền tài khoản";
    view.rerender(<MemoryRouter initialEntries={["/tracker"]}><Routes>
      <Route path="/tracker" element={<TrackerDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText(state.rolesError)).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
  });

});
