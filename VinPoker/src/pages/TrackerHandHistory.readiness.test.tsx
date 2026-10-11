import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    user: { id: "owner-a" } as { id: string } | null,
    loading: false, rolesLoading: false,
    authError: null as string | null, rolesError: null as string | null,
    isTracker: false, isAdmin: false, isClubOwner: true,
  },
  rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args), from: (...args: unknown[]) => state.from(...args) },
}));
vi.mock("@/components/cashier/tournament-live/HandHistoryPanel", () => ({
  HandHistoryPanel: ({ tournamentId }: { tournamentId: string }) => <div data-testid="history-panel">{tournamentId}</div>,
}));
import TrackerHandHistory from "./TrackerHandHistory";

const tour = { id: "tour-a", club_id: "club-a", name: "Archive A", status: "live", created_at: "2026-10-01" };
function view() {
  return <MemoryRouter initialEntries={["/tracker/history?t=tour-a&hand=hand-a"]}><Routes>
    <Route path="/tracker/history" element={<TrackerHandHistory />} />
    <Route path="/" element={<p>Home redirect</p>} />
    <Route path="/auth" element={<p>Login redirect</p>} />
  </Routes></MemoryRouter>;
}

describe("archive permission readiness", () => {
  beforeEach(() => {
    Object.assign(state.auth, { user: { id: "owner-a" }, loading: false, rolesLoading: false,
      authError: null, rolesError: null, isTracker: false, isAdmin: false, isClubOwner: true });
    state.rpc.mockReset().mockResolvedValue({ data: ["club-a"], error: null });
    state.from.mockReset().mockImplementation(() => {
      const query = { select: () => query, order: () => query, in: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [tour], error: null }).then(resolve) };
      return query;
    });
  });

  it("preserves the deep link while roles load, then renders the verified owner archive", async () => {
    state.auth.rolesLoading = true; state.auth.isClubOwner = false;
    const mounted = render(view());
    expect(screen.queryByText("Home redirect")).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
    state.auth.rolesLoading = false; state.auth.isClubOwner = true;
    mounted.rerender(view());
    expect(await screen.findByTestId("history-panel")).toHaveTextContent("tour-a");
    expect(state.rpc).toHaveBeenCalledWith("tracker_club_ids", { _user_id: "owner-a" });
  });

  it("shows unresolved role failure instead of claiming denial or reading data", () => {
    state.auth.isClubOwner = false; state.auth.rolesError = "Không tải được quyền tài khoản";
    render(view());
    expect(screen.queryByText("Home redirect")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(state.auth.rolesError);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not turn an auth network failure into a login redirect", () => {
    state.auth.user = null; state.auth.authError = "Không xác minh được phiên đăng nhập";
    render(view());
    expect(screen.queryByText("Login redirect")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(state.auth.authError);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("still denies a settled user without an eligible role", async () => {
    state.auth.isClubOwner = false;
    render(view());
    expect(await screen.findByText("Home redirect")).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("still sends a settled anonymous user to login", async () => {
    state.auth.user = null; state.auth.isClubOwner = false;
    render(view());
    expect(await screen.findByText("Login redirect")).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not reuse a loaded archive after actor A to B to A without fresh verification", async () => {
    const mounted = render(view());
    expect(await screen.findByTestId("history-panel")).toBeInTheDocument();
    state.rpc.mockImplementation(() => new Promise(() => {}));
    state.auth.user = { id: "owner-b" };
    mounted.rerender(view());
    state.auth.user = { id: "owner-a" };
    mounted.rerender(view());
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Home redirect")).not.toBeInTheDocument();
  });

  it("keeps a verified eligible role despite an unrelated membership lookup failure", async () => {
    state.auth.isAdmin = true; state.auth.isClubOwner = false;
    state.auth.rolesError = "Chưa xác minh được đầy đủ quyền CLB";
    render(view());
    expect(await screen.findByTestId("history-panel")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a rejected archive read as an error instead of leaving loading unresolved", async () => {
    state.rpc.mockRejectedValue(new Error("Failed to fetch"));
    render(view());
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Home redirect")).not.toBeInTheDocument();
  });

  it("hides the old actor archive immediately and ignores their late scope response", async () => {
    const mounted = render(view());
    expect(await screen.findByTestId("history-panel")).toBeInTheDocument();
    let resolveScope!: (value: { data: string[]; error: null }) => void;
    state.rpc.mockImplementation(() => new Promise(resolve => { resolveScope = resolve; }));
    state.auth.user = { id: "owner-b" };
    mounted.rerender(view());
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    await waitFor(() => expect(state.rpc).toHaveBeenLastCalledWith("tracker_club_ids", { _user_id: "owner-b" }));
    state.auth.rolesLoading = true; state.auth.isClubOwner = false;
    mounted.rerender(view());
    await act(async () => resolveScope({ data: ["club-a"], error: null }));
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Home redirect")).not.toBeInTheDocument();
  });
});
