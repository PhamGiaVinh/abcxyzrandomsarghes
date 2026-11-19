import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CashierCashflowPanel from "./CashierCashflowPanel";

const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: (...args: unknown[]) => ({
      abortSignal: (signal: AbortSignal) => {
        abortSignal(signal);
        return rpc(...args);
      },
    }),
  };
  return { useSupabaseClient: () => client };
});

it("skips queued reads while hidden and cancels the previous club read", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const pending: Array<(data: typeof response) => void> = [];
  rpc.mockClear().mockImplementation(() => new Promise(resolve => {
    pending.push(data => resolve({ data, error: null }));
  }));
  abortSignal.mockClear();
  try {
    const view = render(<CashierCashflowPanel clubId="club-test" range={range} />);
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { pending[0](response); });
    expect(rpc).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(rpc).toHaveBeenCalledTimes(2);
    const previousRead: AbortSignal = abortSignal.mock.calls[1][0];
    expect(previousRead.aborted).toBe(false);
    view.rerender(<CashierCashflowPanel clubId="other-club" range={range} />);
    expect(previousRead.aborted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
    await act(async () => {
      pending[2]({ ...response, club_id: "other-club", cash_flow: { ...response.cash_flow, cash_in: 270000 } });
      pending[1](response);
    });
    expect(screen.getByText("270.000 VND")).toBeVisible();
    expect(screen.queryByText("150.000 VND")).toBeNull();
  } finally {
    cleanup();
    visibility.mockRestore();
  }
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
  } else {
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được");
    expect(screen.queryByText("150.000 VND")).not.toBeInTheDocument();
  }
});
