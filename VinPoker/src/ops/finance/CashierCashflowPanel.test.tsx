import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CashierCashflowPanel from "./CashierCashflowPanel";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc };
  return { useSupabaseClient: () => client };
});

const range = { from: "2026-11-01T00:00:00+07:00", to: "2026-11-02T00:00:00+07:00" };
const response = {
  ok: true, club_id: "club-test", ...range,
  cash_flow: { cash_in: 150000, cash_out: 0, bank_in: 0, bank_out: 0, unallocated_bank: 0 },
  unmatched_verified_bank: 0, closed_shift_variance: -1000, drawer_adjustments: 0,
  entry_allocation: { prize_delta: 0, fees_delta: 0, unclassified_entries: 0 },
};

it.each(["confirmed", "wrong club", "wrong cutoff", "missing numbers"])("handles a %s cashflow response", async kind => {
  const data = { ...response };
  if (kind === "wrong club") data.club_id = "other-club";
  if (kind === "wrong cutoff") data.to = "2026-11-03T00:00:00+07:00";
  if (kind === "missing numbers") Object.assign(data, { cash_flow: null });
  rpc.mockResolvedValue({ data, error: null });
  render(<CashierCashflowPanel clubId="club-test" range={range} />);
  if (kind === "confirmed") {
    expect(await screen.findByText("150.000 VND")).toBeVisible();
    expect(screen.queryByText("Thưởng đã chi từ két")).not.toBeInTheDocument();
  } else {
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được");
    expect(screen.queryByText("150.000 VND")).not.toBeInTheDocument();
  }
});

it("displays the drawer prize outflow from the server", async () => {
  rpc.mockResolvedValue({ data: { ...response, cash_flow: { ...response.cash_flow, prize_cash_out: 125000 } }, error: null });
  render(<CashierCashflowPanel clubId="club-test" range={range} />);
  expect(await screen.findByText("Thưởng đã chi từ két")).toBeVisible();
  expect(screen.getByText("125.000 VND")).toBeVisible();
});
