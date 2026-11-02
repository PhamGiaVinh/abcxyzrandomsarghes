import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { displayLabel, isDisplayOnline, listClubDisplays, updateDisplay, type TvDisplayRow } from "./displayAdminRpc";

const { rpc, read } = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: () => {
  const query = { select: () => query, eq: () => query, neq: () => query, order: read };
  return query;
} } }));

describe("listClubDisplays read contract", () => {
  it.each([null, {}, [null], [{ id: "display-a" }], "unavailable"])(
    "reports malformed data instead of accepting it %#", async (data) => {
      read.mockResolvedValueOnce({ data, error: null });
      const result = await listClubDisplays("club-a");
      expect(result.error).toBeTruthy();
      expect(result.data).toEqual([]);
    },
  );
  it("preserves a valid empty list", async () => {
    read.mockResolvedValueOnce({ data: [], error: null });
    expect(await listClubDisplays("club-a")).toEqual({ data: [], error: null });
  });
  it("retains paired and revoked rows without changing their order", async () => {
    const rows = ["paired", "revoked"].map((status, index) => ({
      id: `display-${index}`, club_id: "club-a", display_number: index + 1,
      name: null, zone: null, display_token: "LOCAL_TEST_ONLY", assigned_tournament_id: null,
      layout: "clock", announcement: null, theme: "dark", status,
      last_seen_at: null, paired_at: null, created_at: "2026-10-28T00:00:00Z",
    }));
    read.mockResolvedValueOnce({ data: rows, error: null });
    expect(await listClubDisplays("club-a")).toEqual({ data: rows, error: null });
  });
});

describe("updateDisplay canonical receipt", () => {
  const row: TvDisplayRow = {
    id: "display-a", club_id: "club-a", display_number: 1,
    name: null, zone: null, display_token: "LOCAL_TEST_ONLY",
    assigned_tournament_id: "tour-a", layout: "clock", announcement: null,
    theme: "dark", status: "paired", last_seen_at: null, paired_at: null,
    created_at: "2026-10-28T00:00:00Z",
  };

  it.each([null, {}, { ...row, id: "display-b" }, { ...row, layout: "unknown" }])(
    "does not accept invalid canonical row %#", async (data) => {
      rpc.mockResolvedValueOnce({ data, error: null });
      const result = await updateDisplay(row, { assigned_tournament_id: null });
      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    },
  );

  it("retains a valid server-normalized row and sends the reviewed intent", async () => {
    const saved = { ...row, assigned_tournament_id: null, name: "Lobby" };
    rpc.mockResolvedValueOnce({ data: saved, error: null });
    expect(await updateDisplay(row, { assigned_tournament_id: null, name: " Lobby " }))
      .toEqual({ data: saved, error: null });
    expect(rpc).toHaveBeenLastCalledWith("save_tv_display_config_v1", {
      p_display_id: row.id, p_assigned_tournament_id: null, p_layout: "clock",
      p_announcement: null, p_name: " Lobby ", p_zone: null,
    });
  });
});

describe("isDisplayOnline", () => {
  const now = 1_000_000_000_000;
  it("is offline with no heartbeat", () => {
    expect(isDisplayOnline(null, now)).toBe(false);
  });
  it("is online within the 90s window", () => {
    expect(isDisplayOnline(new Date(now - 10_000).toISOString(), now)).toBe(true);
    expect(isDisplayOnline(new Date(now - 89_000).toISOString(), now)).toBe(true);
  });
  it("is offline past the 90s window", () => {
    expect(isDisplayOnline(new Date(now - 91_000).toISOString(), now)).toBe(false);
    expect(isDisplayOnline(new Date(now - 600_000).toISOString(), now)).toBe(false);
  });
});

describe("displayLabel", () => {
  it("prefers the custom name", () => {
    expect(displayLabel({ name: "Sảnh chính", display_number: 3 })).toBe("Sảnh chính");
  });
  it("falls back to TV + number", () => {
    expect(displayLabel({ name: null, display_number: 3 })).toBe("TV 3");
    expect(displayLabel({ name: "  ", display_number: 2 })).toBe("TV 2");
  });
  it("falls back to plain TV when nothing is set", () => {
    expect(displayLabel({ name: null, display_number: null })).toBe("TV");
  });
});
