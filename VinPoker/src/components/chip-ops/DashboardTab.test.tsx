import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: db.rpc,
  from: (table: string) => {
    const result = { data: table === "tournaments" ? { status: "live", players_remaining: 10, average_stack: 7802500 }
      : Array.from({ length: 10 }, (_, i) => ({ player_name: `Seat ${i}`, chip_count: i === 0 ? 78025000 : 0 })), error: null };
    const query = { select: () => query, eq: () => query, order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) };
    return query;
  },
} }));
import { DashboardTab } from "./DashboardTab";

const inv = { denominations: [], total_value: 0, reconciled: true };
beforeEach(() => db.rpc.mockResolvedValue({ data: { tournament_id: "tour", average_stack: 9750000,
  counts: { total_entries: 11, re_entries: 0, remaining: 8, seated: 8, waiting: 0, busted: 3,
    anomaly_entries: 0, anomaly_seats: 2, live_entry_stack: 78000000, seated_stack: 78000000, waiting_stack: 0 } }, error: null }));
afterEach(cleanup);
describe("Chip overview canonical participation", () => {
  it("keeps physical occupied seats separate from canonical remaining and average", async () => {
    render(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />);
    await waitFor(() => expect(screen.getByText("9.750.000")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("10 ghế đang active")).toBeInTheDocument();
    expect(screen.queryByText("7.802.500")).not.toBeInTheDocument();
  });
  it("does not fall back to stored counters when canonical read fails", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("7.802.500")).not.toBeInTheDocument();
  });
  it("ignores a late canonical response from the previous tournament", async () => {
    let finishOld!: (value: unknown) => void;
    db.rpc.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const { rerender } = render(<DashboardTab tournamentId="old" inv={inv} denoms={[]} />);
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("get_tournament_participation_counts_v1", { p_tournament_id: "old" }));
    await act(async () => rerender(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />));
    await screen.findByText("9.750.000");
    await act(async () => finishOld({ data: null, error: { message: "late 503" } }));
    expect(screen.getByText("9.750.000")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
