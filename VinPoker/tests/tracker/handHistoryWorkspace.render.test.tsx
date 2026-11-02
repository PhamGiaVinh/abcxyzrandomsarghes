import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const backend = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  user: { id: "tracker-user" },
  loading: false,
  isTracker: true,
  isAdmin: false,
  isClubOwner: false,
}));
let latestTournamentQuery: { in: ReturnType<typeof vi.fn> } | undefined;

vi.mock("@/integrations/supabase/client", () => ({ supabase: backend }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => auth,
}));
vi.mock("@/components/cashier/tournament-live/HandHistoryPanel", () => ({
  HandHistoryPanel: ({ tournamentId, workspaceMode, enableHistoricalBatchControls }: {
    tournamentId: string;
    workspaceMode: boolean;
    enableHistoricalBatchControls: boolean;
  }) => (
    <div data-testid="hand-history-panel" data-tournament={tournamentId} data-workspace={workspaceMode} data-batch={enableHistoricalBatchControls}>
      Danh sách bàn và hand
    </div>
  ),
}));

import TrackerHandHistory from "@/pages/TrackerHandHistory";

function tournamentQuery() {
  const response = {
    data: [
      { id: "tour-other-club", club_id: "club-2", name: "Containment UAT", status: "completed", created_at: "2026-06-01T00:00:00Z" },
      { id: "tour-live", club_id: "club-1", name: "TEST — Felt UAT", status: "live", created_at: "2026-08-11T00:00:00Z" },
      { id: "tour-old", club_id: "club-1", name: "Summer Classic", status: "completed", created_at: "2026-07-01T00:00:00Z" },
    ],
    error: null,
  };
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: typeof response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.in.mockImplementation((column: string, values: string[]) => {
    if (column === "club_id") response.data = response.data.filter((row) => values.includes(row.club_id));
    return query;
  });
  latestTournamentQuery = query;
  return query;
}

beforeEach(() => {
  auth.isTracker = true;
  auth.isAdmin = false;
  auth.isClubOwner = false;
  latestTournamentQuery = undefined;
  backend.rpc.mockResolvedValue({ data: ["club-1"], error: null });
  backend.from.mockImplementation(() => tournamentQuery());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tracker hand history workspace", () => {
  it("renders the tournament-first workflow and opens the server-backed hand archive", async () => {
    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Lịch sử & đối chiếu hand" })).toBeInTheDocument();
    expect(screen.getByText("TEST — Felt UAT", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-tournament", "tour-live");
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-workspace", "true");
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-batch", "true");
  });

  it("filters the tournament archive without hiding completed events by default", async () => {
    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);
    await screen.findByText("Summer Classic");

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm giải đấu" }), { target: { value: "summer" } });

    await waitFor(() => expect(screen.queryByText("TEST — Felt UAT", { selector: "button span" })).not.toBeInTheDocument());
    expect(screen.getByText("Summer Classic")).toBeInTheDocument();
  });

  it("does not apply tracker-club narrowing to a super-admin", async () => {
    auth.isAdmin = true;

    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-other-club"]}><TrackerHandHistory /></MemoryRouter>);

    expect(await screen.findByText("Containment UAT", { selector: "h2" })).toBeInTheDocument();
    expect(latestTournamentQuery?.in).not.toHaveBeenCalled();
  });

  it("keeps tracker-only and club-owner accounts on their resolved club scope", async () => {
    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);
    await screen.findByTestId("hand-history-panel");
    expect(latestTournamentQuery?.in).toHaveBeenCalledWith("club_id", ["club-1"]);

    cleanup();
    vi.clearAllMocks();
    auth.isTracker = false;
    auth.isClubOwner = true;
    backend.rpc.mockResolvedValue({ data: ["club-1"], error: null });
    backend.from.mockImplementation(() => tournamentQuery());

    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);
    await screen.findByTestId("hand-history-panel");
    expect(latestTournamentQuery?.in).toHaveBeenCalledWith("club_id", ["club-1"]);
  });

  it("does not load an archive for an unrelated signed-in account", async () => {
    auth.isTracker = false;
    auth.isAdmin = false;
    auth.isClubOwner = false;

    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-other-club"]}><TrackerHandHistory /></MemoryRouter>);

    await waitFor(() => expect(screen.queryByTestId("hand-history-panel")).not.toBeInTheDocument());
    expect(backend.rpc).not.toHaveBeenCalled();
    expect(backend.from).not.toHaveBeenCalled();
  });
});
