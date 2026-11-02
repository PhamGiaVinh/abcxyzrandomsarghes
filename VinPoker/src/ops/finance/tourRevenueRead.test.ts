import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { finalTourRevenueCsv, loadFinalTourRevenue, loadLiveTourRevenue, parseTourRevenue } from "./tourRevenueRead";

const tour = { tournamentId: "tour-a", name: "Flight A", eventDay: "2026-11-04", registrationClosedAt: null,
  buyState: "open" as const,
  provisional: true, paidBuys: 9, waitingSeatBuys: 1, uniquePlayers: 8, refundedBuys: 0, unavailableBuys: 0,
  rake: 90000, serviceFee: 45000, platformFee: 0, collected: 1035000 };
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as unknown as SupabaseClient<Database>;
const closed = "2026-10-29T09:28:00Z";
const final = { status: "final", canExport: true, capturedAt: closed, registrationClosedAt: closed,
  snapshot: { ...tour, buyState: "closed" as const, provisional: false, waitingSeatBuys: 0, registrationClosedAt: closed } };

describe("tour revenue read boundary", () => {
  it.each(["live", "final"])("bounds hung %s reads and releases their timeout", async kind => {
    vi.useFakeTimers();
    try {
      const hung = { rpc: vi.fn(() => new Promise(() => {})) } as unknown as SupabaseClient<Database>;
      const pending = kind === "live" ? loadLiveTourRevenue(hung, "club-a") : loadFinalTourRevenue(hung, "tour-a");
      const rejected = expect(pending).rejects.toThrow("TOUR_REVENUE_READ_TIMEOUT");
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      expect((await loadFinalTourRevenue(client(final), "tour-a")).canExport).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("keeps actual paid rake before event day and paid buys waiting for seating", async () => {
    const read = await loadLiveTourRevenue(client({ clubId: "club-a", asOf: closed, tours: [tour] }), "club-a");
    expect(read.tours[0]).toMatchObject({ rake: 90000, serviceFee: 45000, paidBuys: 9, uniquePlayers: 8, waitingSeatBuys: 1 });
  });
  it("rejects another club instead of showing its totals", async () => {
    await expect(loadLiveTourRevenue(client({ clubId: "club-b", asOf: closed, tours: [tour] }), "club-a")).rejects.toThrow("MALFORMED");
  });
  it("keeps unavailable money distinct from zero and rejects unsafe/negative values", () => {
    expect(parseTourRevenue({ ...tour, unavailableBuys: 1, rake: null, serviceFee: null, platformFee: null, collected: null }).rake).toBeNull();
    expect(() => parseTourRevenue({ ...tour, rake: -1 })).toThrow();
    expect(() => parseTourRevenue({ ...tour, rake: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => parseTourRevenue({ ...tour, unavailableBuys: 1 })).toThrow();
  });
  it("does not convert RPC errors to zero revenue", async () => {
    await expect(loadLiveTourRevenue(client(null, { message: "denied" }), "club-a")).rejects.toThrow("UNAVAILABLE");
  });
  it("requires explicit live buy state and preserves old closed snapshots without that additive field", async () => {
    expect(() => parseTourRevenue({ ...tour, buyState: undefined })).toThrow();
    expect(() => parseTourRevenue({ ...tour, buyState: "closed" })).toThrow();
    expect(parseTourRevenue({ ...tour, buyState: "terminal" }).buyState).toBe("terminal");
    expect((await loadFinalTourRevenue(client({ ...final, snapshot: { ...final.snapshot, buyState: undefined } }), "tour-a")).canExport).toBe(true);
  });
  it("requires the matching frozen snapshot and closure for official export", async () => {
    expect((await loadFinalTourRevenue(client(final), "tour-a")).canExport).toBe(true);
    await expect(loadFinalTourRevenue(client(final), "tour-b")).rejects.toThrow();
    await expect(loadFinalTourRevenue(client({ ...final, snapshot: tour }), "tour-a")).rejects.toThrow();
    await expect(loadFinalTourRevenue(client({ ...final, registrationClosedAt: "2026-10-30T09:28:00Z" }), "tour-a")).rejects.toThrow();
  });
  it.each(["buy_open", "snapshot_missing", "closure_changed", "unavailable"])("blocks export for %s", async status => {
    const read = await loadFinalTourRevenue(client({ status, canExport: false }), "tour-a");
    expect(() => finalTourRevenueCsv(read)).toThrow("NOT_FINAL");
  });
  it("exports frozen server amounts and quotes spreadsheet content safely", async () => {
    const read = await loadFinalTourRevenue(client({ ...final, snapshot: { ...final.snapshot, name: ' =HYPERLINK("bad"),\nTour' } }), "tour-a");
    const csv = finalTourRevenueCsv(read);
    expect(csv).toContain('"90000","45000","0","1035000"');
    expect(csv).toContain('"\' =HYPERLINK(""bad""),\nTour"');
    expect(csv).toContain('"2026-11-04"');
  });
});
