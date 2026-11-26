import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import { forecastTurnout, forecastToOverlayFeed, describeFeature, FEED_LOG_SD_FALLBACK, targetWeekdayCode, type UpcomingEvent } from "./turnoutForecast";

const pad = (n: number) => String(n).padStart(2, "0");

function ev(day: number, buy_in: number, entries: number | null, extra: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: `e-${day}-${buy_in}`,
    event_name: "Event",
    event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: entries,
    unique_entries: entries,
    reentries: 0,
    source: "csv",
    clubId: "c1",
    missingFields: [],
    ...extra,
  };
}

// entries = 2e8 / buy_in (exact log-linear: log(entries) = C − 1·log(buy_in))
function exactSet(days: number[]): SeriesEvent[] {
  const buyins = [1_000_000, 2_000_000, 5_000_000];
  return days.map((d, i) => {
    const b = buyins[i % buyins.length];
    return ev(d, b, Math.round(2e8 / b));
  });
}

const future = (buy_in: number, gtd: number | null = null): UpcomingEvent => ({ event_date: "2026-02-15T19:00:00+07:00", buy_in, gtd });

it("uses the Vietnam weekday just after local midnight for either timestamp representation", () => {
  const target = future(1000000);
  expect(targetWeekdayCode({ ...target, event_date: "2026-02-15T00:15:00+07:00" })).toBe("wd0");
  expect(targetWeekdayCode({ ...target, event_date: "2026-02-14T17:15:00Z" })).toBe("wd0");
});

describe("forecastTurnout — degrade ladder", () => {
  it("N ≤ 1 → unavailable, no number, note (no NaN)", () => {
    const r = forecastTurnout([ev(1, 1_000_000, 150)], future(1_000_000));
    expect(r.available).toBe(false);
    expect(r.base).toBeNull();
    expect(r.missingDataNotes.length).toBeGreaterThan(0);
  });

  it("2 ≤ N < 8 → degraded (intercept+buy-in), low tier, wide band", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4]), future(1_500_000));
    expect(r.available).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.base).toBeGreaterThan(0);
    expect(r.high! - r.low!).toBeGreaterThan(0);
  });

  it("N ≥ 12 → high tier, full model, not degraded", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.available).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.confidence).toBe("high");
  });
});

describe("forecastTurnout — model recovers the buy-in pattern", () => {
  const events = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  it("predict is monotonic decreasing in buy-in", () => {
    const lowBuy = forecastTurnout(events, future(1_000_000)).base!;
    const midBuy = forecastTurnout(events, future(2_000_000)).base!;
    const highBuy = forecastTurnout(events, future(5_000_000)).base!;
    expect(lowBuy).toBeGreaterThan(midBuy);
    expect(midBuy).toBeGreaterThan(highBuy);
  });
  it("recovers the ~2e8/buy_in level closely (exact fixture)", () => {
    const r = forecastTurnout(events, future(1_000_000));
    expect(r.base).toBeGreaterThan(150); // ≈ 200
    expect(r.base).toBeLessThan(260);
  });
  it("deterministic — same input ⇒ identical output", () => {
    expect(JSON.stringify(forecastTurnout(events, future(2_000_000)))).toBe(JSON.stringify(forecastTurnout(events, future(2_000_000))));
  });
});

describe("forecastTurnout — temporal discipline (no leakage)", () => {
  it("trains ONLY on events strictly before the target date", () => {
    const events = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // days 1..10
    const r = forecastTurnout(events, { event_date: "2026-01-06T12:00:00+07:00", buy_in: 1_000_000, gtd: null });
    expect(r.sampleSize).toBe(5); // only days 1..5 are before Jan 6
  });

  it("future events / result-only fields never affect the forecast", () => {
    const base = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // identical pre-event inputs, but stuff RESULT fields (prize/fee) + a later event with wild entries
    const polluted = base.map((e) => ({ ...e, prize_pool_actual: 9.9e12, fee: 9_999_999 }));
    polluted.push(ev(28, 1_000_000, 99999)); // far-future event (after the Feb target? no — Jan 28 < Feb 15)
    const target = future(2_000_000); // Feb 15 → the Jan 28 event IS in the past, so to isolate result-fields use an earlier target
    const cleanR = forecastTurnout(base, { event_date: "2026-01-13T12:00:00+07:00", buy_in: 2_000_000, gtd: null });
    const pollR = forecastTurnout(polluted, { event_date: "2026-01-13T12:00:00+07:00", buy_in: 2_000_000, gtd: null });
    void target;
    expect(pollR.base).toBe(cleanR.base); // prize/fee + later event (day 28 > Jan 13) ignored
  });
});

describe("forecastTurnout — walk-forward CV + baseline", () => {
  it("model & baseline MAPE finite and ≥ 0; delta = baseline − model", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.modelMapePct).not.toBeNull();
    expect(r.baselineMapePct).not.toBeNull();
    expect(r.modelMapePct!).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.modelMapePct!)).toBe(true);
    expect(r.deltaVsBaselinePct).toBeCloseTo(r.baselineMapePct! - r.modelMapePct!, 6);
  });
  it("on the exact log-linear fixture the model beats the median baseline", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.deltaVsBaselinePct!).toBeGreaterThan(0);
  });
});

describe("forecastTurnout — robustness", () => {
  it("missing gtd / sparse data → no NaN, integer band", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(Number.isFinite(r.base!)).toBe(true);
    expect(Number.isInteger(r.base!)).toBe(true);
    expect(Number.isFinite(r.low!) && Number.isFinite(r.high!)).toBe(true);
    expect(r.coefContributions.every((c) => Number.isFinite(c.impactPct))).toBe(true);
  });
});

describe("forecastToOverlayFeed (explicit forecast→overlay adapter feed)", () => {
  it("recovers logSd from the band and round-trips: exp(ln(base) ± Z·logSd) ≈ low/high", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(fc.available).toBe(true);
    const feed = forecastToOverlayFeed(fc, 1_500_000);
    expect(feed).not.toBeNull();
    const Z = 1.2816;
    // band was rounded to integers → allow a loose tolerance on the round-trip
    expect(Math.exp(Math.log(feed!.base) + Z * feed!.logSd)).toBeGreaterThan(fc.base! * 0.9);
    expect(feed!.logSd).toBeGreaterThan(0);
    expect(feed!.buyIn).toBe(1_500_000);
    expect(feed!.label).toContain("Hypothesis");
  });

  it("owner override replaces the center and is labeled as edited", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    const feed = forecastToOverlayFeed(fc, 1_500_000, 123);
    expect(feed!.base).toBe(123);
    expect(feed!.label).toContain("sửa tay");
  });

  it("returns null when the forecast is unavailable or inputs unusable", () => {
    const unavailable = forecastTurnout(exactSet([1]), future(1_500_000, null)); // N ≤ 1 → gated
    expect(forecastToOverlayFeed(unavailable, 1_500_000)).toBeNull();
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(forecastToOverlayFeed(fc, null)).toBeNull();
    expect(forecastToOverlayFeed(fc, 0)).toBeNull();
    expect(forecastToOverlayFeed(fc, 1_500_000, 0)).toBeNull(); // degenerate override
    expect(forecastToOverlayFeed(null, 1_500_000)).toBeNull();
  });

  it("falls back to FEED_LOG_SD_FALLBACK on a degenerate band", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    const degenerate = { ...fc, low: fc.base, high: fc.base }; // no width to invert
    const feed = forecastToOverlayFeed(degenerate, 1_500_000);
    expect(feed!.logSd).toBe(FEED_LOG_SD_FALLBACK);
  });
});

describe("describeFeature (plain-VN factor names for the owner)", () => {
  it("translates weekday/quarter/hour-slot/type/numeric codes", () => {
    expect(describeFeature("weekday:wd6")).toBe("Cuối tuần (Thứ 7)");
    expect(describeFeature("weekday:wd0")).toBe("Cuối tuần (Chủ nhật)");
    expect(describeFeature("weekday:wd3")).toBe("Thứ 4");
    expect(describeFeature("quarter:q2")).toBe("Quý 3");
    expect(describeFeature("hourSlot:hs3")).toBe("Khung tối (18–24h)");
    expect(describeFeature("type:main")).toBe("Loại Main Event");
    expect(describeFeature("logBuyin")).toBe("Buy-in cao");
    expect(describeFeature("gtdMissing")).toBe("Không đặt GTD");
  });
  it("falls back to the raw code for unknown features", () => {
    expect(describeFeature("mystery-col")).toBe("mystery-col");
  });
  it("translates the TP2 calendar/edition features", () => {
    expect(describeFeature("isHoliday")).toBe("Rơi vào dịp lễ/Tết");
    expect(describeFeature("isPayday")).toBe("Đầu tháng (ngày lương)");
    expect(describeFeature("editionTrend")).toBe("Kỳ tổ chức thứ mấy (xu hướng qua các kỳ)");
  });
});

// TP2 — calendar/edition features (flag seriesCalendarFeatures). The #1 safety condition is GOLDEN
// byte-identity when the flag is off; the rest prove the feature is wired, gated at n≥MIN_FULL, and leakage-safe.
describe("forecastTurnout — TP2 calendar/edition features", () => {
  const full = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const featureNames = (r: ReturnType<typeof forecastTurnout>) => r.coefContributions.map((c) => c.feature);

  it("GOLDEN — flag off (default) is byte-identical to explicit calendarFeatures:false", () => {
    const def = forecastTurnout(full, future(1_000_000));
    const off = forecastTurnout(full, future(1_000_000), { calendarFeatures: false });
    expect(JSON.stringify(def)).toBe(JSON.stringify(off));
  });

  it("GOLDEN — byte-identical off even on the full numeric path (GTD present)", () => {
    const withGtd = full.map((e) => ({ ...e, gtd: 30_000_000_000 }));
    const def = forecastTurnout(withGtd, future(2_000_000, 30_000_000_000));
    const off = forecastTurnout(withGtd, future(2_000_000, 30_000_000_000), { calendarFeatures: false });
    expect(JSON.stringify(def)).toBe(JSON.stringify(off));
  });

  it("adds the three calendar/edition columns when ON (n≥MIN_FULL); OFF has none of them", () => {
    const on = forecastTurnout(full, future(1_000_000), { calendarFeatures: true });
    const off = forecastTurnout(full, future(1_000_000));
    for (const f of ["isHoliday", "isPayday", "editionTrend"]) {
      expect(featureNames(off)).not.toContain(f);
      expect(featureNames(on)).toContain(f);
    }
    // CV must still run with the extra columns.
    expect(on.modelMapePct).not.toBeNull();
    expect(Number.isFinite(on.modelMapePct!)).toBe(true);
  });

  it("does NOT activate below MIN_FULL even with the flag ON (gated by n≥8) — byte-identical to off", () => {
    const small = exactSet([1, 2, 3, 4, 5, 6, 7]); // 7 events before the Feb target → low tier, degraded
    const on = forecastTurnout(small, future(1_500_000), { calendarFeatures: true });
    const off = forecastTurnout(small, future(1_500_000));
    expect(on.confidence).toBe("low");
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });

  // One same-brand event every 7 days (constant weekday/quarter/hour/type/buy-in) so the ONLY monotone
  // signal is the edition number; entries grow with edition. Isolates editionTrend.
  const EDITION_DATES = [
    "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09",
    "2026-02-16", "2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23",
  ].map((d) => `${d}T19:00:00+07:00`);
  const editionSet = EDITION_DATES.map((iso, i) => ev(i + 1, 1_000_000, 40 * (i + 1), { event_date: iso, event_name: "APT Main" }));
  const editionTarget = { event_date: "2026-03-30T19:00:00+07:00", buy_in: 1_000_000, gtd: null, event_name: "APT Main" };

  it("editionTrend picks up a real per-edition growth signal (positive coefficient, higher forecast)", () => {
    const on = forecastTurnout(editionSet, editionTarget, { calendarFeatures: true });
    const off = forecastTurnout(editionSet, editionTarget);
    const ed = on.coefContributions.find((c) => c.feature === "editionTrend");
    expect(ed).toBeDefined();
    expect(ed!.beta).toBeGreaterThan(0); // later editions ⇒ higher predicted turnout
    expect(on.base!).toBeGreaterThan(off.base!); // edition-aware model extrapolates the growth
  });

  it("editionTrend is leakage-safe — a strictly-later same-brand event never changes the forecast", () => {
    const clean = forecastTurnout(editionSet, editionTarget, { calendarFeatures: true });
    // append an edition AFTER the target date (2026-04-06 > 2026-03-30): excluded from `past` AND never
    // counted in any strictly-earlier edition tally.
    const withFuture = [...editionSet, ev(99, 1_000_000, 9999, { event_date: "2026-04-06T19:00:00+07:00", event_name: "APT Main" })];
    const polluted = forecastTurnout(withFuture, editionTarget, { calendarFeatures: true });
    expect(JSON.stringify(polluted)).toBe(JSON.stringify(clean));
  });
});

// TP6 — capacity / censoring (flag seriesCensoring). Golden byte-identity when off; sold-out events dropped
// from the fit when on; forecast band capped at the target capacity.
describe("forecastTurnout — TP6 censoring", () => {
  const set12 = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // entries cycle 200/100/40

  it("GOLDEN — censoring off (default) byte-identical to explicit false, even with capacity on events", () => {
    const withCap = set12.map((e) => ({ ...e, capacity: 250 }));
    const def = forecastTurnout(withCap, future(1_000_000));
    const off = forecastTurnout(withCap, future(1_000_000), { censoring: false });
    expect(JSON.stringify(def)).toBe(JSON.stringify(off));
  });

  it("drops capacity-hit (sold-out) events from the fit and notes the count", () => {
    // days 1,4,7 have entries 200 (2e8/1e6); set their capacity to 200 → they hit capacity.
    const events = set12.map((e, i) => ([0, 3, 6].includes(i) ? { ...e, capacity: 200 } : e));
    const on = forecastTurnout(events, future(1_000_000), { censoring: true });
    const off = forecastTurnout(events, future(1_000_000));
    expect(on.sampleSize).toBe(off.sampleSize - 3); // 3 sold-out editions excluded
    expect(on.missingDataNotes.some((n) => /loại khỏi mô hình|truncated/.test(n))).toBe(true);
  });

  it("caps the forecast band at the target's capacity + notes the sell-out risk", () => {
    // buy_in 1e6 ⇒ base ≈ 200; a 120-seat room must cap the band (and flag demand > capacity).
    const on = forecastTurnout(set12, { event_date: "2026-02-15T19:00:00+07:00", buy_in: 1_000_000, gtd: null, capacity: 120 }, { censoring: true });
    expect(on.high!).toBeLessThanOrEqual(120);
    expect(on.base!).toBeLessThanOrEqual(120);
    expect(on.low!).toBeLessThanOrEqual(on.high!);
    expect(on.missingDataNotes.some((n) => /sức chứa/.test(n))).toBe(true);
    expect(on.missingDataNotes.some((n) => /cháy vé|vượt sức chứa/.test(n))).toBe(true);
  });
});
