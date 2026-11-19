// A4b — flag-interaction matrix (seriesInsufficientDataUx × seriesBaselineBattery) at the insufficient-data
// surface. Proves flag OFF keeps the existing branch, flag ON shows the honest baseline_only view (never a
// fabricated 0), and the two flags never conflict.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ FLAGS: {} as Record<string, boolean>, EVENTS: [] as unknown[] }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: h.FLAGS }));
vi.mock("@/lib/series-intelligence/useNativeSeriesEvents", () => ({ useNativeSeriesEvents: () => ({ events: h.EVENTS }) }));

import { TurnoutForecastPanel } from "../TurnoutForecastPanel";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";

afterEach(() => {
  cleanup();
  for (const k of Object.keys(h.FLAGS)) delete h.FLAGS[k];
  h.EVENTS = [];
});

const nfc = (s: string) => s.normalize("NFC");
const has = (s: string) => document.body.textContent!.normalize("NFC").includes(nfc(s));

function ev(day: number, entries: number): SeriesEvent {
  return {
    event_id: `e-${day}`, event_name: "Event", event_date: `2026-01-${String(day).padStart(2, "0")}T19:00:00+07:00`,
    buy_in: 2_000_000, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
function fillInputs() {
  const date = document.body.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(date, { target: { value: "2026-02-15" } });
  const buyin = Array.from(document.body.querySelectorAll('input[type="number"]')).find(
    (i) => (i as HTMLInputElement).placeholder.includes("3000000"),
  ) as HTMLInputElement;
  fireEvent.change(buyin, { target: { value: "2000000" } });
}

// 1 prior event ⇒ the model is unavailable (n=1); the honest path is baseline_only.
const oneEvent = () => {
  h.EVENTS = [ev(1, 200)];
};

it.each([null, 0, 100000])("preserves fee evidence when forwarding a forecast (%s)", (fee) => {
  h.EVENTS = Array.from({ length: 12 }, (_, index) => ({ ...ev(index + 1, 200 + index), fee }));
  const onForecastFeed = vi.fn();
  render(<TurnoutForecastPanel onForecastFeed={onForecastFeed} />);
  fillInputs();
  expect(onForecastFeed).toHaveBeenLastCalledWith(fee === null ? null : expect.objectContaining({ fee }));
  expect(has("Chưa đủ dữ liệu phí để mô phỏng overlay")).toBe(fee === null);
});

describe("A4b panel flag matrix (n=1, model unavailable)", () => {
  it("both flags OFF ⇒ existing warning branch, no A4b view", () => {
    oneEvent();
    render(<TurnoutForecastPanel />);
    fillInputs();
    expect(has("Mốc tham khảo")).toBe(false);
    expect(has("Cần thêm dữ liệu")).toBe(true);
  });

  it("seriesInsufficientDataUx ON ⇒ honest baseline_only 'Mốc tham khảo', never a fabricated 0", () => {
    h.FLAGS.seriesInsufficientDataUx = true;
    oneEvent();
    render(<TurnoutForecastPanel />);
    fillInputs();
    expect(has("Mốc tham khảo")).toBe(true);
    expect(has("Trung vị lịch sử")).toBe(true);
    expect(has("Dự báo: 0")).toBe(false);
    expect(has("bất định tối đa")).toBe(false);
  });

  it("both flags ON ⇒ A4b view renders (A3 comparison card is gated to the full-model branch, not shown)", () => {
    h.FLAGS.seriesInsufficientDataUx = true;
    h.FLAGS.seriesBaselineBattery = true;
    oneEvent();
    render(<TurnoutForecastPanel />);
    fillInputs();
    expect(has("Mốc tham khảo")).toBe(true);
    expect(has("Mốc dự báo đơn giản")).toBe(false); // A3 card only shows when the model IS available
  });

  it("seriesBaselineBattery ON but seriesInsufficientDataUx OFF ⇒ no A4b view (existing warning)", () => {
    h.FLAGS.seriesBaselineBattery = true;
    oneEvent();
    render(<TurnoutForecastPanel />);
    fillInputs();
    expect(has("Mốc tham khảo")).toBe(false);
    expect(has("Cần thêm dữ liệu")).toBe(true);
  });
});
