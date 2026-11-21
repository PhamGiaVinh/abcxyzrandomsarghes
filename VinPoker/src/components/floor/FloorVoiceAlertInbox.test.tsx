// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const query = {
  select: vi.fn(),
  in: vi.fn(),
  order: vi.fn(async () => ({
    data: [{ id: "alert-1", tournament_id: "tour-1", physical_table_id: "physical-5", hand_id: "hand-12", title: "Sai action", priority: "urgent", status: "open" }],
    error: null,
  })),
};
query.select.mockReturnValue(query);
query.in.mockReturnValue(query);

const client = { from: () => query };
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => client,
}));

vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12 }),
}));

import { FloorVoiceAlertInbox } from "./FloorVoiceAlertInbox";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FloorVoiceAlertInbox", () => {
  it("clears alerts when the operator changes even if the tournament list is identical", async () => {
    const tournaments = [{ id: "tour-1", name: "Giải TEST" }];
    const select = vi.fn();
    const view = render(<FloorVoiceAlertInbox readScope="dealer-a" tournaments={tournaments} onSelect={select} />);
    await screen.findByText("Sai action");
    view.rerender(<FloorVoiceAlertInbox readScope={null} tournaments={tournaments} onSelect={select} />);
    expect(screen.queryByText("Sai action")).toBeNull();
    expect(query.order).toHaveBeenCalledTimes(1);
    query.order.mockResolvedValueOnce({ data: [], error: null });
    await act(async () => { view.rerender(<FloorVoiceAlertInbox readScope="dealer-b" tournaments={tournaments} onSelect={select} />); });
    expect(query.order).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Sai action")).toBeNull();
  });

  it("refreshes after reconnect and keeps a closed alert hidden when an older read returns", async () => {
    const previous = await query.order();
    render(<FloorVoiceAlertInbox readScope="floor" tournaments={[{ id: "tour-1", name: "Giải TEST" }]} onSelect={vi.fn()} />);
    await screen.findByText("Sai action");

    let finishOldRead!: () => void;
    query.order.mockImplementationOnce(() => new Promise(resolve => {
      finishOldRead = () => resolve(previous);
    }));
    fireEvent(document, new Event("visibilitychange"));
    query.order.mockResolvedValueOnce({ data: [], error: null });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByText("Sai action")).toBeNull();
    await act(async () => { finishOldRead(); });
    expect(screen.queryByText("Sai action")).toBeNull();
  });

  it("clears the previous tournament immediately and ignores its late refresh", async () => {
    const select = vi.fn();
    const inbox = (id: string) => <FloorVoiceAlertInbox readScope="floor" tournaments={[{ id, name: id }]} onSelect={select} />;
    const view = render(inbox("tour-1"));
    await screen.findByText("Sai action");

    let finishOldRead!: () => void;
    query.order.mockImplementationOnce(() => new Promise(resolve => {
      finishOldRead = () => resolve({
        data: [{ id: "old", tournament_id: "tour-1", physical_table_id: "physical-5", hand_id: "hand-12", title: "Cảnh báo cũ", priority: "urgent", status: "open" }],
        error: null,
      });
    }));
    fireEvent(document, new Event("visibilitychange"));
    query.order.mockResolvedValueOnce({ data: [], error: null });
    view.rerender(inbox("tour-2"));
    expect(screen.queryByText("Sai action")).toBeNull();
    await act(async () => { finishOldRead(); });
    expect(screen.queryByText("Cảnh báo cũ")).toBeNull();
  });

  it("shows an open Tracker alert on the Floor landing and opens its tournament", async () => {
    const onSelect = vi.fn();
    render(<MemoryRouter><FloorVoiceAlertInbox readScope="floor" tournaments={[{ id: "tour-1", name: "Giải TEST" }]} onSelect={onSelect} /></MemoryRouter>);

    expect(await screen.findByText(/Bàn 5 · Hand #12/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Sai action.*Bàn 5.*Hand #12.*Xem toàn bộ ván/i }));
    expect(onSelect).toHaveBeenCalledWith("tour-1", "alert-1");
  });
});
