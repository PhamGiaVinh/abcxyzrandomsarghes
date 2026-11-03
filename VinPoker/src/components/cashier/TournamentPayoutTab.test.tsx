import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TournamentPayoutTab } from "./TournamentPayoutTab";

const { read, withinClubs } = vi.hoisted(() => ({ read: vi.fn(), withinClubs: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "cashier" }, session: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  const query = { select: () => query, in: (...args: unknown[]) => { withinClubs(...args); return query; },
    not: () => query, order: () => query, limit: () => query, abortSignal: read };
  return query;
} } }));
vi.mock("./tournament-live/PrizePayoutTrackingSection", () => ({ PrizePayoutTrackingSection: ({ tournamentId }: { tournamentId: string }) => <p>Payment:{tournamentId}</p> }));
afterEach(cleanup);
beforeEach(() => { read.mockReset(); withinClubs.mockClear(); });
const mount = (entry = "/cashier?tab=tournament_payouts") => render(<MemoryRouter initialEntries={[entry]}><TournamentPayoutTab clubIds={["club-a"]} /></MemoryRouter>);
const tours = [{ id: "tour-a", name: "Giải A", start_time: "2026-11-03" }, { id: "tour-b", name: "Giải B", start_time: "2026-11-02" }];
describe("cashier payout tournament selection", () => {
  it("scopes the list to assigned clubs and unmounts the previous payment form when switching", async () => {
    read.mockResolvedValue({ data: tours, error: null }); mount();
    await screen.findByText("Payment:tour-a");
    expect(withinClubs).toHaveBeenCalledWith("club_id", ["club-a"]);
    fireEvent.change(screen.getByLabelText("Giải đấu"), { target: { value: "tour-b" } });
    expect(screen.getByText("Payment:tour-b")).toBeInTheDocument();
    expect(screen.queryByText("Payment:tour-a")).not.toBeInTheDocument();
  });
  it("does not mount a payment form for a deep link outside the loaded scope", async () => {
    read.mockResolvedValue({ data: tours, error: null }); mount("/cashier?tab=tournament_payouts&tournament=other");
    await screen.findByRole("alert");
    expect(screen.queryByText(/^Payment:/)).not.toBeInTheDocument();
  });
  it("clears the prior form during a failed refresh", async () => {
    read.mockResolvedValueOnce({ data: tours, error: null }); mount();
    await screen.findByText("Payment:tour-a");
    read.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await act(async () => { fireEvent.click(screen.getByText("Làm mới danh sách giải")); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/^Payment:/)).not.toBeInTheDocument();
  });
});
