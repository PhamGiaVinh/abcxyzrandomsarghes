import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner" }, loading: false }) }));

const db = vi.hoisted(() => ({ rows: [
  { id: "live", club_id: "club", deleted_at: null },
  { id: "deleted", club_id: "club", deleted_at: "2026-10-10" },
  { id: "other", club_id: "other", deleted_at: null },
], filters: [] as Array<[string, unknown]>, channels: [] as Array<() => void> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { multiDayTournaments: false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      is: (key: string, value: unknown) => { filters.push([key, value]); db.filters.push([key, value]); return query; },
      in: (key: string, values: unknown[]) => { filters.push([key, values]); return query; },
      order: async () => ({ data: db.rows.filter((r) => filters.every(([k, v]) => Array.isArray(v)
        ? v.includes(r[k as keyof typeof r]) : r[k as keyof typeof r] === v)), error: null }),
    };
    return query;
  },
  channel: () => { const channel = { on: (_: string, __: unknown, cb: () => void) => { db.channels.push(cb); return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
import { useFloorTournaments } from "./useFloorTournaments";

afterEach(() => cleanup());
describe("Floor operational tournament query", () => {
  it("excludes tombstones and other clubs, then removes a newly deleted tour on Realtime refresh", async () => {
    const clubs = ["club"];
    const { result } = renderHook(() => useFloorTournaments(clubs));
    await waitFor(() => expect(result.current.tours.map((r) => r.id)).toEqual(["live"]));
    expect(db.filters).toContainEqual(["deleted_at", null]);
    db.rows[0].deleted_at = "2026-10-10";
    await act(async () => { db.channels[0](); });
    await waitFor(() => expect(result.current.tours).toEqual([]));
  });
});
