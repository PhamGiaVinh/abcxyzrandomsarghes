// D-A — shared recorded-hand name/avatar resolver. Pins:
//  • reads tournament_seats.player_name / avatar_url keyed by player_id (NOT profiles);
//  • no query when tournamentId or ids are empty;
//  • avatar_url-missing → retries selecting player_name only;
//  • unknown/blank rows leave the caller to fall back to the short id;
//  • ids are de-duped before the query.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";
import {
  fetchHandPlayerDisplay,
  handPlayersHasSnapshot,
  __resetHandPlayersSnapshotProbe,
} from "@/lib/tracker-poker/handPlayerNames";

const from = vi.mocked(supabase.from);

/** Stub for the probe `.from(t).select("player_name").limit(1)` resolving to `{error}`. */
function probeQuery(result: { error?: any }) {
  const limitFn = vi.fn().mockResolvedValue(result);
  return { select: vi.fn(() => ({ limit: limitFn })) };
}

/** A chainable stub for `.from(t).select(...).eq(...).in(...)` resolving to `result`. */
function seatQuery(result: { data?: any[] | null; error?: any }) {
  const inFn = vi.fn().mockResolvedValue(result);
  const eqFn = vi.fn(() => ({ in: inFn }));
  const selectFn = vi.fn(() => ({ eq: eqFn, in: inFn }));
  return { select: selectFn, _in: inFn };
}

beforeEach(() => from.mockReset());

describe("fetchHandPlayerDisplay", () => {
  it("maps player_id → name + avatar from tournament_seats (not profiles)", async () => {
    from.mockReturnValue(
      seatQuery({
        data: [
          { player_id: "p1", player_name: "Phil Ivey", avatar_url: "a1.png" },
          { player_id: "p2", player_name: "Tom Dwan", avatar_url: null },
        ],
      }) as any,
    );
    const map = await fetchHandPlayerDisplay("t1", ["p1", "p2"]);
    expect(map.get("p1")).toEqual({ name: "Phil Ivey", avatar: "a1.png" });
    expect(map.get("p2")).toEqual({ name: "Tom Dwan", avatar: null });
    expect(from).toHaveBeenCalledWith("tournament_seats");
  });

  it("no tournamentId or empty ids → no query, empty map", async () => {
    expect((await fetchHandPlayerDisplay(null, ["p1"])).size).toBe(0);
    expect((await fetchHandPlayerDisplay("t1", [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it("avatar_url column missing → first query errors → retry with player_name only", async () => {
    from
      .mockReturnValueOnce(
        seatQuery({ data: null, error: { message: "column avatar_url does not exist" } }) as any,
      )
      .mockReturnValueOnce(seatQuery({ data: [{ player_id: "p1", player_name: "Walk-in 1" }] }) as any);
    const map = await fetchHandPlayerDisplay("t1", ["p1"]);
    expect(map.get("p1")).toEqual({ name: "Walk-in 1", avatar: null });
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("unknown player_id stays absent so the caller falls back to the short id", async () => {
    from.mockReturnValue(
      seatQuery({ data: [{ player_id: "p1", player_name: "X", avatar_url: null }] }) as any,
    );
    const map = await fetchHandPlayerDisplay("t1", ["p1", "p2"]);
    expect(map.has("p2")).toBe(false);
  });

  it("blank player_name → name undefined (caller shows the short id)", async () => {
    from.mockReturnValue(
      seatQuery({ data: [{ player_id: "p1", player_name: "", avatar_url: null }] }) as any,
    );
    const map = await fetchHandPlayerDisplay("t1", ["p1"]);
    expect(map.get("p1")).toEqual({ name: undefined, avatar: null });
  });

  it("de-dupes the ids sent to the query", async () => {
    const q = seatQuery({ data: [] });
    from.mockReturnValue(q as any);
    await fetchHandPlayerDisplay("t1", ["p1", "p1", "p2"]);
    expect(q._in).toHaveBeenCalledWith("player_id", ["p1", "p2"]);
  });

  it("falls back to a valid profile when every seat snapshot is blank", async () => {
    from
      .mockReturnValueOnce(seatQuery({ data: [{ player_id: "p1", player_name: "", avatar_url: null }] }) as any)
      .mockReturnValueOnce(seatQuery({ data: [{ user_id: "p1", display_name: "Profile Name", avatar_url: "profile.png" }] }) as any);
    const map = await fetchHandPlayerDisplay("t1", ["p1"], { includeProfiles: true });
    expect(map.get("p1")).toEqual({ name: "Profile Name", avatar: "profile.png" });
    expect(from).toHaveBeenNthCalledWith(2, "profiles");
  });
});

describe("handPlayersHasSnapshot (E1 feature-detect)", () => {
  beforeEach(() => __resetHandPlayersSnapshotProbe());

  it.each(["42501", "PGRST301", "503"])("does not cache a %s failure as missing schema", async (code) => {
    from.mockReturnValueOnce(probeQuery({ error: { code, message: "temporary read failure" } }) as any)
      .mockReturnValueOnce(probeQuery({ error: null }) as any);
    await expect(handPlayersHasSnapshot()).rejects.toThrow("temporary read failure");
    expect(await handPlayersHasSnapshot()).toBe(true);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("evicts a rejected transport probe so reconnect can retry", async () => {
    from.mockReturnValueOnce({ select: () => ({ limit: () => Promise.reject(new Error("offline")) }) } as any)
      .mockReturnValueOnce(probeQuery({ error: null }) as any);
    await expect(handPlayersHasSnapshot()).rejects.toThrow("offline");
    expect(await handPlayersHasSnapshot()).toBe(true);
  });

  it("true when the probe succeeds; cached (one query for repeated calls)", async () => {
    from.mockReturnValue(probeQuery({ error: null }) as any);
    expect(await handPlayersHasSnapshot()).toBe(true);
    expect(await handPlayersHasSnapshot()).toBe(true); // memoised
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("false when the snapshot column is missing (42703) — safe pre-apply", async () => {
    from.mockReturnValue(probeQuery({ error: { code: "42703", message: "column does not exist" } }) as any);
    expect(await handPlayersHasSnapshot()).toBe(false);
  });
});
