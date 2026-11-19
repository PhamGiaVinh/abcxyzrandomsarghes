// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const alert = { id: "alert-1", tournament_id: "tour-1", physical_table_id: "physical-5", hand_id: "hand-12" as string | null, alert_kind: "wrong_action", source_action_id: null, title: "Sai action", priority: "urgent", status: "open", updated_at: "2026-11-18T09:30:00Z" };
const query = {
  select: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
  abortSignal: vi.fn(async (_signal: AbortSignal) => ({ data: [alert], error: null })),
};
beforeEach(() => {
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
});

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { from: () => query };
  return { useSupabaseClient: () => client };
});

vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12 }),
}));

import { FloorVoiceAlertInbox } from "./FloorVoiceAlertInbox";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("FloorVoiceAlertInbox", () => {
  it("opens an operational alert without suggesting a hand change", async () => {
    query.abortSignal.mockResolvedValueOnce({ data: [
      { ...alert, alert_kind: "display_issue", hand_id: null, title: "Màn hình bàn sai" },
    ], error: null });
    const onSelect = vi.fn();
    render(<FloorVoiceAlertInbox tournaments={[{ id: "tour-1", name: "Giải TEST" }]} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: /Màn hình bàn sai.*Mở cảnh báo/i }));
    expect(screen.queryByText(/Action sai chưa được chỉ rõ|Xem toàn bộ ván/)).not.toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith("tour-1", "alert-1");
  });

  it("shows an open Tracker alert on the Floor landing and opens its tournament", async () => {
    const onSelect = vi.fn();
    render(<MemoryRouter><FloorVoiceAlertInbox tournaments={[{ id: "tour-1", name: "Giải TEST" }]} onSelect={onSelect} /></MemoryRouter>);

    expect(await screen.findByText(/Bàn 5 · Hand #12/)).toBeVisible();
    expect(screen.getByRole("region", { name: "Việc TD cần xử lý" }).querySelector("time"))
      .toHaveAttribute("datetime", alert.updated_at);
    fireEvent.click(screen.getByRole("button", { name: /Sai action.*Bàn 5.*Hand #12.*Xem toàn bộ ván/i }));
    expect(onSelect).toHaveBeenCalledWith("tour-1", "alert-1");
  });

  it("removes previous-tour work immediately and ignores a late response", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let finishPrevious!: (result: { data: typeof alert[]; error: null }) => void;
    query.abortSignal.mockResolvedValueOnce({ data: [alert], error: null });
    query.abortSignal.mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }));
    query.abortSignal.mockResolvedValueOnce({ data: [
      alert,
      { ...alert, id: "alert-2", tournament_id: "tour-2", title: "Cần xem lại hand" },
    ], error: null });
    const onSelect = vi.fn();
    const view = render(<FloorVoiceAlertInbox tournaments={[{ id: "tour-1", name: "Giải cũ" }]} onSelect={onSelect} />);
    await act(async () => {});
    expect(screen.getByText("Sai action")).toBeVisible();
    fireEvent.focus(window);
    expect(query.abortSignal).toHaveBeenCalledTimes(2);
    const previousSignal = query.abortSignal.mock.calls[1][0];
    view.rerender(<FloorVoiceAlertInbox tournaments={[{ id: "tour-2", name: "Giải mới" }]} onSelect={onSelect} />);
    expect(screen.queryByText("Sai action")).toBeNull();
    expect(previousSignal.aborted).toBe(true);
    await act(async () => { finishPrevious({ data: [alert], error: null }); });
    expect(screen.queryByText("Sai action")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cần xem lại hand/ }));
    expect(onSelect).toHaveBeenCalledWith("tour-2", "alert-2");
  });
});
